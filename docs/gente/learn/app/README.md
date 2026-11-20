# Gente "it learns you": in-app proof

Captured on 19 Nov 2026 from this branch running on a Mac: the real web UI, API and worker, a
throwaway Homebrew Postgres in /tmp, and Ollama `swift-1.5-27b` at num_ctx 32768. Every item
below was made by the bot or by the screen's own buttons, not seeded into the database.

| File                               | What it shows                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| 01-input-box-chips.png             | One input box; Projects, Brains, Skills one click away                                   |
| 02-project-made-by-bot.png         | The bot made "Coffee cart launch" with 3 tasks and marked one done (project_update tool) |
| 03-project-feedback-timeline.png   | Feedback typed in the project, and the timeline the bot keeps                            |
| 04-brain-from-feedback.png         | A cited brain distilled by the model from that feedback                                  |
| 05-skill-change-held-with-diff.png | A learned skill change, held, with its diff and reason                                   |
| 06-skill-change-live-undo.png      | The same change after "Use it", now live with Undo                                       |
| 07-goal-saved-by-bot.png           | A goal the bot saved from chat (goal_update tool)                                        |
| 08-goals-after-proactive-cycle.png | After one proactive cycle: a second goal added from the project                          |

Model turn times on the shared 27B: project 511 s, skill create plus update 1,179 s, goal 159 s.
