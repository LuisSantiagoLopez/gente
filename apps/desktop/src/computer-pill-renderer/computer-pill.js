// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
// Words arrive in the query string, already in the app's language; state arrives from the main process.
const params = new URLSearchParams(location.search);
const title = document.getElementById("title");
const hint = document.getElementById("hint");
const stop = document.getElementById("stop");
const words = {
  title: params.get("title") || "Gente is using your computer",
  hint: params.get("hint") || "",
  stop: params.get("stop") || "Stop",
  stopped: params.get("stopped") || "Stopped",
};
title.textContent = words.title;
hint.textContent = words.hint;
stop.textContent = words.stop;
stop.setAttribute("aria-label", `${words.stop}. ${words.hint}`);

stop.addEventListener("mouseenter", () => window.gentePill?.hover(true));
stop.addEventListener("mouseleave", () => window.gentePill?.hover(false));
stop.addEventListener("click", () => window.gentePill?.stop());

function show(state) {
  if (state === "stopped") {
    title.textContent = words.stopped;
    hint.textContent = "";
    stop.hidden = true;
  } else if (state === "in") {
    title.textContent = words.title;
    hint.textContent = words.hint;
    stop.hidden = false;
  }
  document.body.dataset.state = state;
}
window.gentePill?.onState(show);
if (params.get("state")) show(params.get("state"));
