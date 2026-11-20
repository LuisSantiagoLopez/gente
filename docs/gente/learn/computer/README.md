# Gente using your computer

Proof images of the pill, rendered from `apps/desktop/src/computer-pill-renderer` in headless
Chrome (not a screenshot of the Electron window on a real desktop).

- `pill-in.png`, `pill-in-dark.png`: shown while Gente drives the screen.
- `pill-hover-stop.png`: pointer over Stop (the only part of the pill that takes clicks).
- `pill-stopped.png`: after Stop or the stop key.
- `pill-enter.gif`: the spring as it appears. Reduced motion turns it off.

## Stop

- Stop key while the pill shows: Mac ⌘⇧Esc (falls back to ⌘⌥⇧S), Windows Ctrl+Alt+Esc
  (falls back to Ctrl+Alt+Shift+S). Never Ctrl+Shift+Esc (Task Manager).
- Stop ends the screen action in progress at once, refuses every later screen action of that run,
  and the server cancels the run the way the chat's Stop does.
- A run stopped between two screen actions is cancelled at its next screen action.

## What still asks first

Looking at apps never asks. Acting asks only when the call spends money, sends something as the
person, deletes their data, or agrees to legal terms, and asks every time. It reads:

- the purpose the assistant states for the call,
- the names of buttons and fields it clicks or sets, from its latest look at that app,
- menu items it picks,
- Return in chat apps, Cmd/Ctrl+Return and Cmd/Ctrl+Shift+D in mail apps, Delete in Finder or
  File Explorer.

Not caught: typed text (it is the person's content), a click by x,y position or on an element the
assistant has not looked at, and wording outside the word list. The shell on the person's computer
is unchanged: it asks until one command was approved.
