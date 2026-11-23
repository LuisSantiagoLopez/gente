# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente.
#
# Cloud GPU, shared mode (the default): one warm GPU answers many chats at once. vLLM batches
# their requests, so the price per chat falls with every chat that joins. Same model, flags and
# snapshot as the dedicated GPU in modal_app.py, with room for 64 requests at a time.
#
# Privacy is the same as dedicated mode: no prompt is logged or stored, and each request stands
# alone. The app sends a per-chat `cache_salt`, so the prompt cache is never shared between chats
# (one chat cannot learn anything from another's cache timing), and nothing outlives the
# container, which scales to zero 5 minutes after the last request.
#
# Who calls it: apps/desktop/src/main/cloud-gpu/cloud-gpu-route.ts (shared mode) with
# `Authorization: Bearer <key>`; control_app.py `/warm` keeps one ready while people are active.
# Deploy: `modal deploy infra/cloud-gpu/shared_app.py` (never touches the dedicated snapshot).
import os
import subprocess

import modal
from modal_app import (
    GPU,
    MINUTES,
    PORT,
    WARMUP,
    WEIGHTS,
    _http,
    _wait_ready,
    compile_cache,
    gpu_image,
    secret,
    vllm_command,
    weights,
)

MAX_REQUESTS = 64
app = modal.App("yourai-cloud-gpu-shared")


@app.server(
    image=gpu_image.add_local_python_source("modal_app"),
    gpu=GPU,
    port=PORT,
    secrets=[secret],
    volumes={WEIGHTS: weights, "/root/.cache/vllm": compile_cache},
    memory=96 * 1024,
    cpu=8,
    target_concurrency=48,
    max_concurrency=MAX_REQUESTS,
    max_containers=int(os.environ.get("YOURAI_MAX_SHARED_GPUS", "2")),
    scaledown_window=5 * MINUTES,
    startup_timeout=20 * MINUTES,
    unauthenticated=True,  # vLLM checks the key on every request
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Shared:
    @modal.enter(snap=True)
    def start(self):
        self.proc = subprocess.Popen(vllm_command(max_seqs=MAX_REQUESTS))
        _wait_ready(self.proc, 18 * MINUTES)
        for _ in range(3):
            _http("POST", "/v1/chat/completions", WARMUP, timeout=300)
        _http("POST", "/sleep?level=1", timeout=300)

    @modal.enter(snap=False)
    def wake(self):
        _http("POST", "/wake_up", timeout=300)
        _wait_ready(self.proc, 5 * MINUTES)

    @modal.exit()
    def stop(self):
        self.proc.terminate()
