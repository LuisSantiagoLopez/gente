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
