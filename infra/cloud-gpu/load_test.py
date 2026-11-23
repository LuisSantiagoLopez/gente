# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente.
#
# Load test for the shared Cloud GPU: N chats at once, each with its own cache_salt and a
# 4,000-token system prompt (about what Your AI sends with its tools), streaming a ~350-token
# answer. Prints one JSON line per concurrency level: aggregate and per-chat tokens/s, first-word
# times. Reads the key from the macOS Keychain (account gente, service modal-gpu); prints no key.
#   .venv-modal/bin/python infra/cloud-gpu/load_test.py [url] [1,8,32,64]
import asyncio
import json
import statistics
import subprocess
import sys
import time

import aiohttp

URL = (sys.argv[1] if len(sys.argv) > 1 else "") or "https://luis-santiago-l-sanchez--yourai-cloud-gpu-shared-shared.us-east.modal.direct"
LEVELS = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else "1,8,32,64").split(",")]
KEY = subprocess.run(
    ["security", "find-generic-password", "-a", "gente", "-s", "modal-gpu", "-w"],
    capture_output=True, text=True,
).stdout.strip()
SYSTEM = ("You are Your AI, a helpful assistant on the person's Mac. Follow the rules. " * 270)[:16000]
TOPICS = ["rainbows", "a lighthouse", "a lost cat", "the moon", "a bakery", "a robot", "the sea", "a city"]


async def one(session: aiohttp.ClientSession, i: int, salt: str) -> dict:
    body = {
        "model": "yourai-cloud",
        "stream": True,
        "max_tokens": 450,
        "stream_options": {"include_usage": True},
        "chat_template_kwargs": {"enable_thinking": False},
        "cache_salt": salt,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Write a 250-word story about {TOPICS[i % len(TOPICS)]}, number {i}."},
        ],
    }
    t0 = time.monotonic()
    first = None
    tokens = 0
    async with session.post(f"{URL}/v1/chat/completions", json=body,
                            headers={"authorization": f"Bearer {KEY}"}) as res:
        if res.status != 200:
            return {"error": res.status}
        async for raw in res.content:
            line = raw.decode().strip()
            if not line.startswith("data: ") or line.endswith("[DONE]"):
                continue
            data = json.loads(line[6:])
            if data.get("usage"):
                tokens = data["usage"]["completion_tokens"]
            for c in data.get("choices", []):
                if first is None and (c.get("delta", {}).get("content")):
                    first = time.monotonic() - t0
    total = time.monotonic() - t0
    return {"first_s": first or total, "total_s": total, "tokens": tokens,
            "tok_s": tokens / max(1e-6, total - (first or 0))}


async def level(n: int, run: int) -> dict:
    timeout = aiohttp.ClientTimeout(total=600)
    async with aiohttp.ClientSession(timeout=timeout, connector=aiohttp.TCPConnector(limit=0)) as s:
        t0 = time.monotonic()
        results = await asyncio.gather(*[one(s, i, f"run{run}-chat{i}") for i in range(n)])
        wall = time.monotonic() - t0
    ok = [r for r in results if "error" not in r]
    firsts = sorted(r["first_s"] for r in ok)
    return {
        "chats": n,
        "errors": len(results) - len(ok),
        "aggregate_tok_s": round(sum(r["tokens"] for r in ok) / wall, 1),
        "per_chat_tok_s_median": round(statistics.median(r["tok_s"] for r in ok), 1),
        "first_word_s_median": round(statistics.median(firsts), 2),
        "first_word_s_p95": round(firsts[max(0, int(len(firsts) * 0.95) - 1)], 2),
        "wall_s": round(wall, 1),
    }


async def main():
    await level(1, 0)  # warm the connection and the GPU
    for run, n in enumerate(LEVELS, start=1):
        print(json.dumps(await level(n, run)), flush=True)


asyncio.run(main())
