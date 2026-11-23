# Cloud GPU speed log

One line per round: what was measured, the slowest part, the fix, the result.
GPU: Modal H100 unless said. Model: Qwen 3.6 35B-A3B FP8, vLLM 0.32, MTP (3 draft tokens).
"From Mac" numbers include the network round trip from San Francisco to Modal us-east.

## Round 1 (2026-11-22, curl-style client from the Mac, `bench.py`)

| Test | Local Mac (Ollama, IQ4_XS) | Cloud H100 |
|---|---|---|
| "hey", first word | 0.12 to 1.0 s warm (48 s when the model was paged out) | 0.36 to 0.66 s |
| 600-word story, first word | 0.52 s | 0.36 s |
| 600-word story, tokens/s | 19.4 | 351 |
| 600-word story, total | 41.1 s (789 tokens) | 2.7 s (829 tokens) |
| Tool call (weather), streamed | n/a | yes, arguments stream in pieces; first token 1.4 s with thinking |
| Cold start to first word, fresh GPU | n/a | 17.7 s, 21.2 s (snapshot restore); 138 s on the first restore |

- B200 (one-off, measured inside the container): 380 to 411 tokens/s. About 13% faster than H100
  for 58% more money ($6.25/h vs $3.95/h). H100 stays the default.
- MTP mean acceptance 3.29 tokens per step.
- Slowest part: cold start (17 to 21 s). A redeploy throws the snapshot away and the next boot
  takes about 10 minutes (FlashInfer JIT + DeepGEMM warmup).

## Round 2 (app UI)

- Found: with Cloud GPU on, runs hung before the first model call. The live context window was a
  getter-only property; the runtime assigns limits on the model, which threw. Fixed (setter), with
  a wire test that runs a whole turn with the cloud limits file.
- Prewarm: a GPU starts when the switch turns on and while the person types.
- Local "make a simple to-do web app" in the app (Ollama, E2B computer): 143 s, 3 files, no
  context error, the app works (added and checked off a to-do in Chrome).

## Round 3: warm pool

- Slowest part: a cold GPU (17 to 40 s from a snapshot, about 10 min after a deploy).
- Fix: `/warm` lease on the control app keeps one GPU up while the person is active (renewed on
  the switch, typing and each answer; ends after 15 idle minutes, or by a 2-minute check if the
  app crashed). Control moved to its own Modal app, so changing it never drops the GPU snapshot.
- Result: a new dedicated session attaches to the warm GPU in 1.96 s (was 17 to 21 s).

## Round 4: shared mode (default) for the economics

One warm H100 serves many chats (vLLM batching). Each chat: 4,000-token prompt with its own
`cache_salt`, ~350-token answer. Second run (first run warms batch shapes; it was 2 to 4x worse).

| Chats at once | Total tokens/s | Per chat tokens/s | First word median / p95 | $ per 1M tokens (GPU full) |
|---|---|---|---|---|
| 1 | 238 | 347 | 0.52 s / 0.52 s | $4.61 |
| 8 | 1,134 | 218 | 0.79 s / 0.79 s | $0.97 |
| 32 | 2,688 | 119 | 1.24 s / 1.51 s | $0.41 |
| 64 | 3,531 | 79 | 1.72 s / 2.47 s | $0.31 |

- Average conversation (10 messages, ~5,000 output tokens): $0.002 at 32 chats at once,
  $0.023 alone on the GPU.
- The fixed cost is the GPU being up: $3.95/h = $94.80/day always on, $47.40/day for 12 active
  hours, $0 idle with scale to zero (but then a 17 to 40 s cold start).
- Dedicated (a GPU per chat) costs $3.95/h per chat while it is up; kept as the "Private" option.
- Privacy: no prompt logs (vLLM default, uvicorn access log off), per-chat `cache_salt`, nothing on
  disk, container gone 5 min after the last request.
- Numbers for the billing page: `infra/cloud-gpu/cost-model.json`.

## Round 5: measured in the app (packaged 1.0.8, throwaway data, Cloud GPU shared)

Same packaged build, same prompts, from pressing Send to the reply on screen.

| Test | This Mac (Ollama) | Cloud GPU (shared H100) |
|---|---|---|
| "hey", first word | 2.32 s | 1.32 s (2.33 s before the warm connection and Keychain cache) |
| 600-word story, first word | 21.9 s (thinks first) | 2.33 s |
| 600-word story, total | 54.6 s (~25 tokens/s) | 5.2 s (~320 tokens/s; 2.5 s of writing) |
| Cold start, first word on a fresh GPU | n/a | 17.5 s, 45.8 s ("Starting cloud GPU… N s" shown) |
| "make a simple to-do web app" | 143 s, 3 files, works, no context error | 188 s, 3 files, works, no context error |
| Ask card, card on screen | 20.7 s | 2.6 s; answer used 3.7 s after the click |

- The to-do app time is set by the bots' computer (E2B), not the model: it took 132 s (local run)
  and 177 s (cloud run) to start. The cloud model's own work in that run was about 35 s.
- Fixes this round: keep-alive connection opened while typing (TLS was ~160 ms per message),
  Keychain key cached (a process launch per message), one cache salt per app so a person's chats
  reuse their long instructions, and a cold shared GPU is waited for (503) instead of falling back.
- Still over 1 s for "hey": about 0.6 to 0.9 s is the app itself (run setup before the model
  call); the GPU answers a bare "hey" in 0.36 to 0.52 s from the Mac. A us-west GPU would save
  ~0.1 s but costs 1.75x, so it is not used.

## Round 6: the two misses ("hey" under 1 s; to-do app under 60 s)

First word is now timed inside the page (Enter key to first reply character, MutationObserver),
so the proof script's own polling no longer adds up to 0.4 s.

**"hey" app-side setup.** A trace through run assembly and a CPU profile of the gap before the
model call showed assembly takes 110 to 260 ms, then 680 ms went to loading pi-ai's chat client
(the OpenAI SDK) on the first message: 634 ms of that was opening files. It is now loaded 1.5 s
after the server starts (`prewarmLocalChatClient` in pi-local-provider.ts).

| "hey", first word (warm GPU) | Before | After |
|---|---|---|
| Cloud, exact in-page | 1.105 s | 0.66 s, 0.63 s, 0.98 s, 1.31 s |
| Gap from setup done to model call | 840 ms | 40 to 50 ms |
| This Mac, exact in-page | | 1.66 s |

**To-do app.** The bots' E2B computer spent 170 s of its 177 s start installing desktop tools and
the page browser on every fresh sandbox. They are now baked into the `rakazo-computer` E2B
template (same steps still run on start and find everything in place).

| "make a simple to-do web app" | Computer start | Total | App works |
|---|---|---|---|
| Cloud, before | 177 s | 188 s | yes |
| Cloud, after (GPU cold: 33 s restore) | 7.7 s | 77 s | yes |
| Cloud, after (GPU warm) | 4.5 s | 12.2 s, 8.3 s | yes, yes |
| This Mac, after | | 522 s | yes |

- Found and fixed: one app quitting sent `/warm 0` and turned off the shared GPU for everyone
  (that is why one run hit a cold GPU). Each app now holds its own lease (`client` id); the
  pool stays warm while any lease is live.
