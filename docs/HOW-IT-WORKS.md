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
- The request goes to Ollama on this Mac (`http://127.0.0.1:11434/v1/chat/completions`).

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
