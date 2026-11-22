// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * What ask_user returns once a task has asked its cards. It must be true: no card was shown, so
 * the model has no answer to this question and must decide for itself instead of asking in text.
 */
export const ASK_CARDS_LIMIT_RESULT =
  "No card was shown: you already asked the person enough questions in this task. Do not ask anything more, in a card or in your reply. Choose sensible defaults for what is still open, say in one short line which ones you chose, and do the work now.";
