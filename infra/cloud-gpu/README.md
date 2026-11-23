# Cloud GPU on Modal

One rented GPU per chat for Your AI. It boots from a snapshot, serves the same model as the Mac
(Qwen 3.6 35B-A3B, FP8, vLLM) with a 128K window, and is gone about a minute after the chat ends.

## Two modes

- Shared (default): `shared_app.py`, one warm GPU answers many chats at once (vLLM batching).
  Each app sends its own `cache_salt`, so other people never share its prompt cache.
- Private: `modal_app.py`, a GPU of its own per chat (sticky session, one per container).

## Files

- `download_weights.py`: copies the weights into the Modal Volume `yourai-weights` (CPU, once).
- `modal_app.py`: the dedicated GPU server (`Gpu`).
- `shared_app.py`: the shared GPU server (`Shared`).
- `control_app.py`: start/stop sessions and the warm lease (`/warm`), as its own Modal app so a
  change to it never throws away a GPU snapshot.
- `load_test.py`: 1/8/32/64 chats at once against the shared GPU.
- `SPEED-LOG.md`: every round, with numbers. `cost-model.json`: the numbers for the billing page.

## Set up (owner's Mac)

1. `uv venv --python 3.12 .venv-modal && uv pip install --python .venv-modal/bin/python modal`
2. Modal needs a payment method on the workspace before any GPU runs.
3. Key: `openssl rand -hex 32`, saved in the Keychain
   (`security add-generic-password -a gente -s modal-gpu -w <key> -U`) and in the Modal Secret
   `yourai-cloud-gpu` as `YOURAI_GPU_KEY` (`modal secret create yourai-cloud-gpu --from-json ...`).
4. `modal run --detach infra/cloud-gpu/download_weights.py`
5. `modal deploy` `modal_app.py`, `shared_app.py` and `control_app.py` (`YOURAI_GPU` picks the
   GPU). Redeploying a GPU app throws its snapshot away: the next boot takes about 10 minutes.
6. The first few sessions build the snapshot; later ones restore from it.

## How a chat reaches its GPU

1. The app calls `POST <control>/start` with the key. `control` runs inside Modal and starts a
   sticky session on `Gpu`; it answers with the GPU's address and a session token.
2. Each chat request goes straight to the GPU with `Authorization: Bearer <key>` (checked by
   vLLM) and `Modal-Authorization: Bearer <session token>` (routes it to that chat's container).
3. `max_concurrency=1` means one session per container: two chats never share a GPU.
4. `POST <control>/stop` ends the session; the container scales down 60 s later. A session the
   app forgets ends by itself after 5 idle minutes.

## Privacy

vLLM request logging is off (its default) and uvicorn access logs are off, so prompts are not
logged. Nothing is written to a Volume during a chat. The KV cache lives only in the container.
