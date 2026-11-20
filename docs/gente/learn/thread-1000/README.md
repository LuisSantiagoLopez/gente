# 1000-turn recall, real model

Model: `swift-1.5-27b` on Ollama, num_ctx 32768, temperature 0, thinking off. Ran 2026-11-19T23:47:54.330Z.
Fact planted at turn 20: code name MARIGOLD-7. Question: "Quick check: what was the project code name I gave you?"
Compaction: scripted, forgetful (writes only the newest batch); real ledger merge.

| Turn | Context               | Recent messages sent | Prompt tokens | Wall ms | Recalled | Answer                                                                     |
| ---- | --------------------- | -------------------- | ------------- | ------- | -------- | -------------------------------------------------------------------------- |
| 100  | gente                 | 98                   | 2511          | 28606   | yes      | The project code name is MARIGOLD-7.                                       |
| 500  | gente                 | 98                   | 2606          | 29541   | yes      | The project code name is MARIGOLD-7.                                       |
| 1000 | gente                 | 98                   | 2615          | 27268   | yes      | The project code name is MARIGOLD-7.                                       |
| 1000 | last-50-only baseline | 50                   | 1185          | 17234   | no       | I don't have a record of a specific project code name in our conversation. |

Wall time includes queueing behind any other request the shared local model was serving.
