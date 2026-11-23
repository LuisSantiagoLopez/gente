# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente.
#
# Your AI's Cloud GPU on Modal. One rented GPU per chat session, started from a memory + GPU
# snapshot so it boots fast, and gone a minute after the session ends.
#
#   Gpu      vLLM serving Qwen 3.6 35B-A3B (FP8) with an OpenAI-compatible /v1/chat/completions.
#            Sticky sessions with at most one session per container: no two sessions share a GPU.
#
# Sessions are started and stopped by control_app.py (a separate Modal app, so changing it never
# throws away this server's snapshot). Chat requests come straight from the desktop app's model
# router (apps/desktop/src/main/cloud-gpu/cloud-gpu-route.ts) with the session token.
# Weights: `modal run infra/cloud-gpu/download_weights.py` once. Deploy: `modal deploy` this file.
# Privacy: vLLM request logging stays off and uvicorn access logs are off, so no prompt is logged.
import os
import subprocess
import time

import modal

APP_NAME = "yourai-cloud-gpu"
MODEL = os.environ.get("YOURAI_MODEL", "Qwen/Qwen3.6-35B-A3B-FP8")
SERVED_NAME = "yourai-cloud"
GPU = os.environ.get("YOURAI_GPU", "H100")
CONTEXT = int(os.environ.get("YOURAI_CONTEXT", "131072"))
SPEC_TOKENS = int(os.environ.get("YOURAI_MTP", "3"))
VLLM_VERSION = "0.32.0"
PORT = 8000
MINUTES = 60
WEIGHTS = "/weights"


def model_dir(model: str = MODEL) -> str:
    return f"{WEIGHTS}/{model.replace('/', '--')}"


weights = modal.Volume.from_name("yourai-weights", create_if_missing=True)
compile_cache = modal.Volume.from_name("yourai-vllm-cache", create_if_missing=True)
secret = modal.Secret.from_name("yourai-cloud-gpu")

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install(f"vllm=={VLLM_VERSION}", "huggingface-hub[hf_transfer]")
    .env(
        {
            "VLLM_SERVER_DEV_MODE": "1",  # sleep / wake_up endpoints, used around the snapshot
            "TORCHINDUCTOR_COMPILE_THREADS": "1",
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "HF_HUB_OFFLINE": "1",
            "VLLM_NO_USAGE_STATS": "1",
            # JIT kernels land on the cache Volume, so a full boot (a new snapshot) skips rebuilding.
            "FLASHINFER_WORKSPACE_BASE": "/root/.cache/vllm/flashinfer",
            "DG_JIT_CACHE_DIR": "/root/.cache/vllm/deep_gemm",
            "DO_NOT_TRACK": "1",
            "YOURAI_MODEL": MODEL,
            "YOURAI_GPU": GPU,
            "YOURAI_CONTEXT": str(CONTEXT),
            "YOURAI_MTP": str(SPEC_TOKENS),
        }
    )
)

app = modal.App(APP_NAME)


def vllm_command() -> list[str]:
    cmd = [
        "vllm", "serve", model_dir(),
        "--served-model-name", SERVED_NAME,
        "--host", "0.0.0.0", "--port", str(PORT),
        "--api-key", os.environ["YOURAI_GPU_KEY"],
        "--max-model-len", str(CONTEXT),
        "--max-num-seqs", "8",
        "--gpu-memory-utilization", "0.92",
        "--enable-prefix-caching",
        "--reasoning-parser", "qwen3",
        "--enable-auto-tool-choice", "--tool-call-parser", "qwen3_coder",
        "--language-model-only",
        "--enable-sleep-mode",
        "--disable-uvicorn-access-log",
        "--uvicorn-log-level", "warning",
    ]
    if SPEC_TOKENS > 0:
        cmd += [
            "--speculative-config",
            '{"method":"mtp","num_speculative_tokens":%d}' % SPEC_TOKENS,
        ]
    return cmd


def _http(method: str, path: str, body: bytes | None = None, timeout: float = 30) -> int:
    import urllib.request

    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {os.environ['YOURAI_GPU_KEY']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        res.read()
        return res.status


def _wait_ready(proc: subprocess.Popen, limit_s: float):
    deadline = time.time() + limit_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"vLLM exited with code {proc.returncode}")
        try:
            if _http("GET", "/health", timeout=2) == 200:
                return
        except Exception:
            time.sleep(0.5)
    raise TimeoutError("vLLM did not become ready")


WARMUP = b"""{"model":"yourai-cloud","max_tokens":64,"messages":[
 {"role":"system","content":"You are a helpful assistant."},
 {"role":"user","content":"What is the weather in Paris? Use the tool."}],
 "tools":[{"type":"function","function":{"name":"get_weather","description":"Weather for a city",
 "parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]}"""


@app.server(
    image=gpu_image,
    gpu=GPU,
    port=PORT,
    secrets=[secret],
    volumes={WEIGHTS: weights, "/root/.cache/vllm": compile_cache},
    memory=96 * 1024,
    cpu=8,
    target_concurrency=1,
    max_concurrency=1,  # one session per container: a session's GPU is never shared
    max_containers=int(os.environ.get("YOURAI_MAX_GPUS", "3")),
    scaledown_window=60,
    startup_timeout=20 * MINUTES,
    unauthenticated=True,  # still needs a session token (minted only by `control`) and the key
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
@modal.sessioned()
class Gpu:
    @modal.enter(snap=True)
    def start(self):
        self.proc = subprocess.Popen(vllm_command())
        _wait_ready(self.proc, 18 * MINUTES)
        for _ in range(3):  # compile the chat, reasoning and tool-call paths before the snapshot
            _http("POST", "/v1/chat/completions", WARMUP, timeout=300)
        _http("POST", "/sleep?level=1", timeout=300)

    @modal.enter(snap=False)
    def wake(self):
        _http("POST", "/wake_up", timeout=300)
        _wait_ready(self.proc, 5 * MINUTES)

    @modal.exit()
    def stop(self):
        self.proc.terminate()
