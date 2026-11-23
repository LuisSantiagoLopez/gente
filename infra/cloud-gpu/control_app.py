# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente.
#
# The Cloud GPU control endpoint, a tiny CPU web app the desktop app calls. It holds no Modal
# token: it runs inside Modal, which lets it start sessions on the GPU server and change its
# warm pool. Kept apart from modal_app.py so redeploying it never throws away the GPU snapshot.
#
#   POST /start  {idle_timeout}  -> a sticky session on its own GPU: {url, token, gpu, ...}
#   POST /stop   {token}         -> ends that session; the GPU scales down 60 s later
#   POST /warm   {minutes, mode, client} -> this app's lease on one ready GPU (0 = drop it): the shared
#                                   GPU, or a spare dedicated one, so a
#                                   new chat never waits for a cold start. A 2-minute check lets
#                                   the spare go when the lease runs out, even if the app crashed.
# Every call needs `Authorization: Bearer <key>` (Modal Secret `yourai-cloud-gpu`).
# Who calls it: apps/desktop/src/main/cloud-gpu/cloud-gpu-sessions.ts and cloud-gpu-warm.ts.
# Deploy: `modal deploy infra/cloud-gpu/control_app.py`.
import os
import time

import modal

GPU_APP = "yourai-cloud-gpu"
SHARED_APP = "yourai-cloud-gpu-shared"
GPU = os.environ.get("YOURAI_GPU", "H100")
CONTEXT = 131072
MAX_WARM_MINUTES = 60

app = modal.App("yourai-cloud-gpu-control")
secret = modal.Secret.from_name("yourai-cloud-gpu")
leases = modal.Dict.from_name("yourai-cloud-gpu-warm", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("fastapi[standard]")


async def set_spare(count: int, mode: str = "dedicated"):
    """Dedicated: a spare GPU beyond the ones chats hold. Shared: keep one shared GPU up."""
    if mode == "shared":
        shared = modal.Server.from_name(SHARED_APP, "Shared")
        await shared.autoscaler.update.aio(min_containers=count)
    else:
        server = modal.Server.from_name(GPU_APP, "Gpu")
        await server.autoscaler.update.aio(buffer_containers=count)


@app.function(
    image=image,
    secrets=[secret],
    cpu=0.25,
    memory=512,
    scaledown_window=15 * 60,
    timeout=20 * 60,  # the first boot after a GPU deploy builds the snapshot and takes minutes
    enable_memory_snapshot=True,
)
@modal.asgi_app(label="yourai-cloud-gpu-control")  # keeps the address the app already uses
def control():
    import hmac

    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    server = modal.Server.from_name(GPU_APP, "Gpu")

    def check(authorization: str | None):
        want = f"Bearer {os.environ['YOURAI_GPU_KEY']}"
        if not authorization or not hmac.compare_digest(authorization, want):
            raise HTTPException(status_code=401)

    class Start(BaseModel):
        idle_timeout: int = 300

    class Stop(BaseModel):
        token: str

    class Warm(BaseModel):
        minutes: int = 15
        mode: str = "shared"
        # Each app holds its own lease; the pool stays warm while any lease is live.
        client: str = "default"

    @api.post("/start")
    async def start(body: Start, authorization: str | None = Header(default=None)):
        check(authorization)
        began = time.monotonic()
        timeout = max(60, min(body.idle_timeout, 1800))
        session = await server.sessions.start.aio(idle_timeout=timeout)
        return {
            "url": await server.get_url.aio(),
            "token": session.token,
            "session_id": session.session_id,
            "gpu": GPU,
            "context": CONTEXT,
            "model": "yourai-cloud",
            "start_ms": int((time.monotonic() - began) * 1000),
        }

    @api.post("/stop")
    async def stop(body: Stop, authorization: str | None = Header(default=None)):
        check(authorization)
        await server.sessions.terminate.aio(body.token)
        return {"stopped": True}

    @api.post("/warm")
    async def warm(body: Warm, authorization: str | None = Header(default=None)):
        check(authorization)
        minutes = max(0, min(body.minutes, MAX_WARM_MINUTES))
        mode = "dedicated" if body.mode == "dedicated" else "shared"
        client = body.client[:64] or "default"
        until = time.time() + minutes * 60
        held = await leases.get.aio(f"leases:{mode}", {}) or {}
        if minutes > 0:
            held[client] = until
        else:
            held.pop(client, None)
        held = {k: v for k, v in held.items() if v > time.time()}
        await leases.put.aio(f"leases:{mode}", held)
        await set_spare(1 if held else 0, mode)
        return {"warm_until": until if minutes > 0 else None, "leases": len(held)}

    @api.get("/health")
    async def health():
        return {"ok": True}

    return api


@app.function(image=image, schedule=modal.Period(minutes=2), cpu=0.125, memory=256)
async def expire_warm():
    """Lets the spare GPU go once no app renewed its lease (they quit or crashed)."""
    for mode in ("shared", "dedicated"):
        held = await leases.get.aio(f"leases:{mode}", {}) or {}
        live = {k: v for k, v in held.items() if v > time.time()}
        if live != held:
            await leases.put.aio(f"leases:{mode}", live)
            if not live:
                await set_spare(0, mode)
