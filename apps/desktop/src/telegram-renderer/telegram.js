// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
(() => {
  const form = document.getElementById("form");
  const input = document.getElementById("token");
  const button = document.getElementById("connect");
  const status = document.getElementById("status");
  const say = (text, tone) => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    say("Checking with Telegram…");
    try {
      const result = await window.genteTelegram.connect(input.value);
      if (result.ok) {
        input.value = "";
        say(`Connected to @${result.username}. Open it in Telegram and say hi. In Gente, Settings → Messaging gives you a code to send it once.`, "ok");
      } else {
        say(result.message, "warn");
      }
    } catch {
      say("That didn't go through. Please try again.", "warn");
    } finally {
      button.disabled = false;
    }
  });
})();
