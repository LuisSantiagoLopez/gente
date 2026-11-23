# How a chat message works

This is the path one message takes, from the moment you press Enter to the reply on screen.
Read the files in this order to follow the code.

## 1. You type a message

- The chat box sends it to the server.
  `apps/web/src/pages/shell/composer/use-composer-actions.ts` calls `rpc.threads.send`.

## 2. The server saves it and starts a run

- The API receives the message.
  `apps/api/src/routes/threads.ts` (the `send` handler).
- It saves your message and creates a **run** (one job of work for the AI).
  `apps/api/src/threads/thread-target.ts` (`sendThreadMessage`).
- It wakes the worker for that run.
  `packages/adapters/src/runs/wakeups/wake-run.ts`.

## 3. The worker gets the run ready

- The worker picks up the run.
  `apps/worker/src/index.ts`, then `packages/adapters/src/runs/executor/executor.ts`.
- It gathers what the model needs: instructions, chat history, tools.
  `packages/adapters/src/runs/assembly/run-assembly.ts`.
  The rules the AI follows are in `packages/adapters/src/runs/assembly/run-instructions.prompt.ts`.
  The tools it can call are listed in `packages/adapters/src/tools/builtin.tool-definition.ts`.

## 4. The model thinks and acts

- One model turn starts here: `packages/adapters/src/runs/turn/run-model-turn.ts`.
- The agent loop runs the model, then each tool it asks for, then the model again.
  `packages/adapters/src/runtime/pi/pi-runtime.ts`.
- Tools are carried out in `packages/adapters/src/runtime/pi/tools/pi-runtime-tools.ts`.
- Before each request goes to the local model, it is trimmed for speed (small talk, language,
  honesty rule). `packages/adapters/src/runtime/pi/models/burrow-fast-chat.ts`.
- The request goes through the app's loopback model router
  (`apps/desktop/src/main/burrow/model-router.ts`) to Ollama on this Mac
  (`http://127.0.0.1:11434/v1/chat/completions`), or to a rented GPU when Cloud GPU is on
  (see "Cloud GPU" below).

## 5. What the model writes streams back

- The worker turns the model's output into chat events as it arrives.
  `packages/adapters/src/runs/turn/run-turn.ts` (`consumeRunEvents`).
- Reply text and live thinking go out as short-lived progress events.
  `packages/adapters/src/runs/lifecycle/run-progress.ts`.
- Each stretch of thinking is also saved, so you can open it later.
  `packages/adapters/src/runs/lifecycle/run-thoughts.ts`.
- When the turn ends, the final reply is saved as a message.

## 6. The screen updates

The chat screen was rebuilt in 1.0.7 ("chat v2"). One path draws every turn.

- The app listens on one live stream and hands each event to the chat screen.
  `apps/web/src/pages/shell/chat/use-thread-sync.ts` calls `emitChatEvent`
  (`apps/web/src/lib/chat-v2/chat-event-bus.ts`).
- One pure reducer folds the events into turns: your message, then the AI's answer
  (status, thinking, steps, reply text, cards, start and end times).
  `apps/web/src/lib/chat-v2/chat-state.ts`; how each event changes one answer is in
  `chat-run-events.ts`, the shapes in `chat-types.ts` and small helpers
  in `chat-turns.ts`.
- When a chat opens (or reloads), its saved messages and steps become turns, and are merged into
  the live state without losing what is streaming. `apps/web/src/lib/chat-v2/chat-snapshot.ts`.
- A React hook ties the two together. `apps/web/src/lib/chat-v2/use-chat-state.ts`.
- The screen draws the turns. Read these in order:
  1. `apps/web/src/components/chat/ChatScreen.tsx`: gathers the actions cards need.
  2. `MessageList.tsx`: the scrolling list. Auto-scroll only while you are at the bottom
     (`use-follow-bottom.ts`). Quoting a selection: `use-quote-selection.ts`.
  3. `UserBubble.tsx`: your message.
  4. `AssistantTurn.tsx`: the AI's answer.
  5. `ActivityLine.tsx`: the one arrow beside the AI's avatar. "Thinking…" with the newest
     thought while it works, "Writing…" with a timer while it writes a file, then
     "Thought for 4s" or "Worked for 52s · 3 steps". Its words: `lib/chat-v2/activity-summary.ts`.
  6. `ActivityTimeline.tsx` and `ActivityStep.tsx`: the opened arrow. Real thoughts and real
     steps in order; click a step to see what went in and came out.
  7. `ReplyText.tsx`: the reply. One element from the first token to the end.
  8. `CardMessage.tsx`: question cards, pages, computers and files (reuses `message-view.tsx`).
- Tests replay event streams recorded from real runs of the local model:
  `apps/web/src/lib/chat-v2/chat-state.test.ts` (fixtures in `__fixtures__/`) and
  `chat-steps.test.ts`.

### Why thinking did not show before 1.0.7

Fast chat turned thinking off (`reasoning_effort: "none"`) for every short question and for the
first step of a task, so the model sent no thinking at all. Asking it to think ("think
carefully", "piensa bien") now keeps thinking on.
`packages/adapters/src/runtime/pi/models/burrow-thinking.ts`.

## When the AI asks you something

1. The model calls `ask_user` with one or more questions.
   `packages/adapters/src/runtime/pi/tools/pi-runtime-ask-user.ts`.
2. The run pauses and saves a question card.
   `packages/adapters/src/runs/turn/run-turn-pause.ts`.
3. You click an option or type your own answer.
   `apps/web/src/components/messages/AskCard.tsx` and `QuestionOptions.tsx`.
4. The server records the answer and turns it into words for the model.
   `packages/db/src/threads/thread-ask.ts` (`answerRunInput`),
   using `packages/core/src/asks/ask-questions.ts`.
5. The run resumes. Your answer is the result of the model's `ask_user` call.
   `packages/adapters/src/runtime/pi/pi-runtime.ts` (the restore step).

The test that proves step 5 end to end:
`packages/testkit/src/runtime/pi-runtime-ask-answer.test.ts`.

## Cloud GPU (a rented GPU per chat)

When the "Cloud GPU" switch beside Send is on, each chat gets its own GPU on Modal. It starts on the
chat's first message (or while you type), answers with the same model as this Mac
(Qwen 3.6 35B-A3B, FP8) and a 128K context window, and is let go when the chat is done.
Read in this order:

1. The switch and the status line ("Starting cloud GPU… 2.1 s", then "Cloud GPU · H100", then
   gone). `apps/web/src/pages/shell/composer/CloudGpuToggle.tsx`, its words in
   `apps/web/src/lib/cloud-gpu/cloud-gpu-status.ts`, its state in `use-cloud-gpu.ts`.
2. The desktop side, set up once at launch. `apps/desktop/src/main/cloud-gpu/cloud-gpu-ipc.ts`.
3. The switch itself: saved in the app's data folder, and while on it writes
   `cloud-gpu-limits.json` (128K window) in the server's folder.
   `apps/desktop/src/main/cloud-gpu/cloud-gpu-toggle.ts`.
4. The worker reads that file when each run starts, so long tasks such as "make an app" no
   longer hit "Required context exceeds the model context budget".
   `packages/adapters/src/runtime/pi/models/pi-local-limits.ts`.
5. Each request names its chat (`x-session-affinity`, sent by pi-ai because the local model sets
   `sendSessionAffinityHeaders`). The router sends it to that chat's GPU.
   `apps/desktop/src/main/burrow/model-router.ts`, then `cloud-gpu/cloud-gpu-route.ts`.
6. One session per chat: started through the Modal control endpoint, reused for every step of the
   chat, stopped 90 s after the final answer (5 min if a tool is still running), when the switch
   goes off, or when the app quits. `apps/desktop/src/main/cloud-gpu/cloud-gpu-sessions.ts`.
7. The request is reshaped for vLLM (model name, Qwen's thinking switch) and its stream is watched
   to see whether it ended with an answer or a tool call. `cloud-gpu/cloud-gpu-request.ts`.
8. If the GPU will not start or stops answering, one fresh GPU is tried, then this Mac answers and
   the status line says so. The runs after that use this Mac's own window.
   A request waits at most 90 s for its GPU to start (`START_WAIT_MS`): the runtime drops a
   request with no reply after 120 s, and the first start after a deploy can take many minutes.
   Until the GPU is up, this Mac answers each step at once and the line says
   "this Mac answers until it is ready". Quitting waits at most 3 s for a GPU still starting.
   A chat too long for this Mac's window (over about 85,000 characters) is never handed to the
   Mac: its answer starts at once and sends an empty chunk every 20 s until the GPU is up, then
   the GPU's stream follows. `cloud-gpu/cloud-gpu-hold.ts`.
   Screenshots are replaced by a short note (the GPU's model reads text only), and a request the
   GPU refuses (400, 413, 422) is answered here once without dropping the GPU.
9. Each answer is measured as it streams: first token, tokens per second, total, as one line in
   `<stack>/logs/cloud-gpu-meter.jsonl` (numbers only). `cloud-gpu/cloud-gpu-meter.ts`.
10. The Modal side: `infra/cloud-gpu/modal_app.py` (vLLM on one GPU, memory + GPU snapshot, sticky
   sessions with one session per container, scale to zero 60 s after a session ends) and
   `infra/cloud-gpu/README.md` (deploy, key, costs).

The endpoint key is in the macOS Keychain (account `gente`, service `modal-gpu`) and in the
Modal Secret `yourai-cloud-gpu`. It is never in code or git.

Tests: `apps/desktop/src/main/cloud-gpu/*.test.ts` (sessions, switch, request),
`apps/desktop/src/main/burrow/model-router-cloud.test.ts` (on, off, one GPU per chat, fallback,
stop at session end), `packages/adapters/src/runtime/pi/models/pi-local-limits.test.ts` and
`apps/web/src/lib/cloud-gpu/cloud-gpu-status.test.ts`.

## Making things in one chat: an app, a website, a video

The model learns how from three built-in skills, listed in every turn's skills catalog and read
with `skill_read`: "Build a web app", "Publish a website" and "Make a video with code".
`packages/adapters/src/tools/builtin-make-skills.prompt.ts` (added to the list in
`builtin-skills.prompt.ts`).

- The work happens on the bot's cloud computer (E2B). It has ffmpeg, python3 and Chrome; it has
  no Node and no Pillow, so the skills install them.
- Websites go online with `npx vercel deploy --temporary`: a live link with no account, for 60
  minutes, plus a claim link that keeps it live after a free Vercel sign-in.
- Videos are drawn frame by frame with Pillow and piped to ffmpeg (H.264, yuv420p), because image
  and video generators may be unavailable.
- Files reach the person with `attach_file`; an HTML file with a name opens as an artifact.

How these were tested: `apps/desktop/e2e/usecase-driver.mjs` drives one long chat on a packaged
build (throwaway data, `GENTE_STACK=native`, optional Cloud GPU). Each file dropped in its inbox
folder is sent as the next message; every turn writes timings, the reply and a screenshot.
