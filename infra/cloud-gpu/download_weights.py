# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente.
#
# Copies the Cloud GPU model's weights from Hugging Face into the Modal Volume once, so a cold GPU
# reads them from Modal's own storage and never waits on Hugging Face. CPU only, run by hand:
#   modal run --detach infra/cloud-gpu/download_weights.py [--model Qwen/Qwen3.6-35B-A3B-FP8]
# Read by: modal_app.py (mounts the same Volume at /weights).
import os

import modal

WEIGHTS = "/weights"
weights = modal.Volume.from_name("yourai-weights", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("huggingface-hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)
app = modal.App("yourai-cloud-gpu-weights")


@app.function(image=image, volumes={WEIGHTS: weights}, timeout=3600, cpu=4)
def download(model: str):
    from huggingface_hub import snapshot_download

    target = f"{WEIGHTS}/{model.replace('/', '--')}"
    snapshot_download(model, local_dir=target, ignore_patterns=["*.md", ".gitattributes"])
    weights.commit()
    return sorted(os.listdir(target))


@app.local_entrypoint()
def main(model: str = "Qwen/Qwen3.6-35B-A3B-FP8"):
    print(download.remote(model))
