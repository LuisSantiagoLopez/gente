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

- The app listens on one live stream and applies each event.
  `apps/web/src/pages/shell/chat/use-thread-sync.ts`,
  then `packages/core/src/threads/thread-snapshot-events.ts` (`reduceThreadSnapshot`).
- The chat list draws each message.
  `apps/web/src/pages/shell/chat/transcript.tsx` and `message-view.tsx`.
- A streamed reply keeps the same bubble when it becomes the saved message.
  `apps/web/src/lib/chat/stable-message-keys.ts`.
- Under each reply is one arrow: "Thought for 4s" or "Worked for 52s · 3 steps".
  Open it to see the thinking and the steps in order.
  `apps/web/src/components/messages/RunActivityRow.tsx` and `RunActivityTimeline.tsx`.
  The steps come from `packages/core/src/runs/run-activity.ts`.

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

# Updates

One button updates the app on every platform.

## When it shows
- The app checks 8 seconds after launch, then every 6 hours.
- If a newer version exists, the sidebar shows **Update to vX.Y.Z**. So does Settings.
- Nothing downloads until you click.

## Where the versions come from
- Releases live in the public repo `LuisSantiagoLopez/yourai-releases` (no source code).
- `latest.yml` is the Windows feed. `latest-mac.yml` is the Mac feed.
- The `gente-platforms` workflow uploads both. It writes `latest-mac.yml` only after both
  DMGs (arm64 and x64) are built, with the size and sha512 of each.

## Windows
electron-updater downloads the installer, checks it, installs it and relaunches.
The button just starts it (`apps/desktop/src/main/updates/auto-update.ts`).

## Mac (unsigned builds)
Squirrel.Mac refuses apps without an Apple Developer ID, so the Mac uses its own updater
(`apps/desktop/src/main/updates/mac/`), driven by the same button:
1. Read `latest-mac.yml` and compare versions (`versions.ts`, `mac-feed.ts`).
2. Download the DMG for this Mac (arm64 or x64) with the app's own HTTP client, so macOS adds no
   quarantine flag. Check its size and sha512 (`download.ts`).
3. Mount the DMG read-only and check the app inside is ours and the right version
   (`mac-installer.ts`).
4. Start a small helper script, then quit (`helper-script.ts`). The helper waits for the app to
   quit, moves the old app to a backup, copies the new one in with `ditto`, removes quarantine,
   relaunches, and unmounts the DMG. If the copy fails, it puts the backup back and relaunches
   the old version. The next check then shows "Try again".
5. If the app folder is not writable, the helper starts behind the macOS admin prompt. You type
   your password into macOS; the app never sees it.

If the app runs from the DMG or from Downloads (macOS "translocation"), the button says
**Move to Applications** instead. One click moves it and relaunches it there.

## Safe by default
- Any failure leaves the old version running and shows one sentence plus **Try again**.
- Each step is written to `support.log`.
- Your data lives in `~/Library/Application Support`, outside the app, so updates never touch it.

## Tests
- Unit: `apps/desktop/src/main/updates/mac/*.test.ts`, `update-now.test.ts`.
- End to end on a Mac, all in a temp folder: `mac/mac-update.e2e.test.ts` (real DMG, local
  server, real `open`; good update, corrupted download, rollback).
