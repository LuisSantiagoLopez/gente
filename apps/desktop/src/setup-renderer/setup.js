// Modified by DeskHead Inc. from Rakazo: one-screen onboarding with the local Swift model.
(() => {
  const bridge = window.rakazoSetup;
  document.documentElement.dataset.platform = bridge?.platform ?? "browser";
  const messages = bridge?.locale?.messages ?? {};

  /** Core's `translate`, which this plain page cannot import: English-keyed, `{name}` placeholders. */
  function t(message, values) {
    const template = Object.hasOwn(messages, message) ? messages[message] : message;
    if (!values) return template;
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) =>
      Object.hasOwn(values, key) ? String(values[key]) : match,
    );
  }

  /** The page is written in English; it switches to the app's language before it first paints. */
  function translatePage() {
    document.documentElement.lang = bridge?.locale?.lang ?? "en";
    document.documentElement.dir = bridge?.locale?.dir ?? "ltr";
    document.title = t(document.title);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue.trim();
      if (text !== "") node.nodeValue = node.nodeValue.replace(text, () => t(text));
    }
    for (const element of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
      for (const name of ["title", "aria-label", "placeholder"]) {
        const value = element.getAttribute(name);
        if (value !== null) element.setAttribute(name, t(value));
      }
    }
  }
  translatePage();

  const form = document.getElementById("setup");
  const serverUrl = document.getElementById("server-url");
  const serverHeaders = document.getElementById("server-headers");
  const serverHeadersSection = document.getElementById("server-headers-section");
  const panelNew = document.getElementById("panel-new");
  const panelExisting = document.getElementById("panel-existing");
  const stackSection = document.getElementById("stack");
  const stackPhase = document.getElementById("stack-phase");
  const stackOutput = document.getElementById("stack-output");
  const stackDetail = document.getElementById("stack-detail");
  const stackDetails = document.getElementById("stack-details");
  const stackProgress = document.getElementById("stack-progress");
  const stackProgressFill = document.getElementById("stack-progress-fill");
  const stackHint = document.getElementById("stack-hint");
  const status = document.getElementById("status");
  const checkButton = document.getElementById("check");
  const continueButton = document.getElementById("continue");
  const quitButton = document.getElementById("quit");
  const steps = document.querySelector(".steps");
  const advancedButton = document.getElementById("advanced");
  const stackIdle = document.getElementById("stack-idle");
  const stepStack = document.getElementById("step-stack");
  const stepBrain = document.getElementById("step-brain");
  const brainStatus = document.getElementById("brain-status");
  const brainSize = document.getElementById("brain-size");
  const brainProgress = document.getElementById("brain-progress");
  const brainProgressFill = document.getElementById("brain-progress-fill");
  const brainDetail = document.getElementById("brain-detail");
  const brainModels = document.getElementById("brain-models");
  const brainModelList = document.getElementById("brain-model-list");

  const STACK_POLL_MS = 1000;
  /** How often setup looks for Docker again while it waits for the person to install or open it. */
  const DOCKER_RECHECK_MS = 3000;
  // Linux has Docker Engine and no single installer; macOS and Windows get Docker Desktop.
  const dockerDesktop = bridge?.platform !== "linux";
  const PHASE_LABELS = {
    "checking-docker": t("Getting ready…"),
    preparing: t("Getting ready…"),
    pulling: t("Downloading the workspace…"),
    starting: t("Starting the workspace…"),
    "waiting-healthy": t("Almost ready…"),
    ready: t("Workspace ready."),
  };
  const TERMINAL_PHASES = new Set([
    "idle",
    "docker-missing",
    "docker-not-running",
    "ready",
    "failed",
  ]);
  const PHASE_PROGRESS = {
    "checking-docker": 0.06,
    preparing: 0.12,
    pulling: 0.2,
    starting: 0.82,
    "waiting-healthy": 0.92,
    ready: 1,
  };
  /** Docker reports bytes pulled but never a total, so the bar approaches the next phase without reaching it. */
  const PULL_SPAN = 0.6;
  const PULL_SCALE_BYTES = 1.2e9;

  let defaultLocalUrl = "";
  let cloudUrl = "";
  /** Bumped on user edits, mode switches, and new async runs; a run left behind is stale. */
  let requestGeneration = 0;
  /** Generation of the check in flight; an edit or mode switch retires it and releases its lock. */
  let activeCheck = 0;
  let stackPolling = false;
  let lastStack = null;
  let lastProgress = 0;
  let detailsOpen = false;
  /** Set when a failure opened the output; a retry closes it again, a person's own click does not. */
  let detailsOpenedByFailure = false;
  /** Resolves the poll wait early when the main process pushes a new state. */
  let wakePoll = null;
  let dockerRecheckTimer = null;
  /** True from a background look for Docker until it reports something other than its own check. */
  let dockerRechecking = false;

  function selectedMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked === null ? "new" : checked.value;
  }

  function setStatus(message, tone) {
    status.textContent = message;
    if (tone === undefined) status.removeAttribute("data-tone");
    else status.setAttribute("data-tone", tone);
  }

  function setBusy(busy) {
    checkButton.disabled = busy;
    continueButton.disabled = busy;
  }

  /** A save in flight cannot be cancelled, so the choice it commits must not change under it. */
  function lockChoice(locked) {
    for (const input of form.querySelectorAll('input[name="mode"]')) input.disabled = locked;
    serverUrl.disabled = locked;
    serverHeaders.disabled = locked;
  }

  function syncPanels() {
    const mode = selectedMode();
    steps.hidden = mode !== "new";
    advancedButton.textContent =
      mode === "new" ? t("Connect to a server instead") : t("Run on this Mac instead");
    panelNew.hidden = mode !== "new";
    panelExisting.hidden = mode !== "existing";
    checkButton.hidden = mode !== "existing";
    // Only This computer can be waiting on Docker, where setup looks again on its own.
    continueButton.hidden = false;
    continueButton.textContent = mode === "new" ? t("Get started") : t("Continue");
    setStatus("");
  }

  function isDockerPhase(phase) {
    return phase === "docker-missing" || phase === "docker-not-running";
  }

  function downloadedBytes(stack) {
    return Object.values(stack.layerBytes ?? {}).reduce((total, bytes) => total + bytes, 0);
  }

  function formatBytes(bytes) {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
    if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
    return `${Math.round(bytes)} B`;
  }

  function progressFor(stack) {
    const base = PHASE_PROGRESS[stack.phase] ?? 0;
    if (stack.phase !== "pulling") return base;
    return base + PULL_SPAN * (1 - Math.exp(-downloadedBytes(stack) / PULL_SCALE_BYTES));
  }

  function renderProgress(stack) {
    const running = stack.phase in PHASE_PROGRESS;
    stackProgress.hidden = !running;
    if (!running) {
      lastProgress = 0;
      stackProgressFill.style.width = "0%";
      return;
    }
    // A retry restarts at its phase; otherwise the bar only ever moves forward.
    lastProgress =
      stack.phase === "checking-docker"
        ? progressFor(stack)
        : Math.max(lastProgress, progressFor(stack));
    const percent = (lastProgress * 100).toFixed(1);
    stackProgressFill.style.width = `${percent}%`;
    stackProgress.setAttribute("aria-valuenow", percent);
  }

  function renderDetails(stack) {
    const bytes = stack.phase === "pulling" ? downloadedBytes(stack) : 0;
    stackDetail.textContent = bytes > 0 ? t("{size} downloaded", { size: formatBytes(bytes) }) : "";

    // A new attempt clears the output, so drop an expansion the person did not ask for.
    if (stack.phase === "checking-docker" && detailsOpenedByFailure) {
      detailsOpen = false;
      detailsOpenedByFailure = false;
    }
    const hasOutput = stack.output.length > 0;
    // A failure asks the person to read the output, so open it for them.
    // Gente: technical output is written to logs/setup.log, never opened on screen.
    if (false && stack.phase === "failed" && hasOutput && !detailsOpen) {
      detailsOpen = true;
      detailsOpenedByFailure = true;
    }
    stackDetails.hidden = !hasOutput;
    stackDetails.setAttribute("aria-expanded", String(detailsOpen && hasOutput));
    stackOutput.hidden = !(detailsOpen && hasOutput);
    if (!stackOutput.hidden) {
      stackOutput.textContent = stack.output.join("\n");
      stackOutput.scrollTop = stackOutput.scrollHeight;
    }
  }

  function renderStack(stack) {
    const { phase } = stack;
    // A background re-check for Docker would flash "Getting ready…"; keep the waiting view until it
    // either finds Docker (and moves on) or settles back on a Docker phase.
    if (phase === "checking-docker" && dockerRechecking) return;
    dockerRechecking = false;
    lastStack = stack;
    stackSection.hidden = phase === "idle";
    stackIdle.hidden = phase !== "idle";
    stepStack.dataset.state =
      phase === "idle"
        ? "todo"
        : phase === "ready"
          ? "done"
          : phase === "failed"
            ? "error"
            : "active";
    continueButton.hidden = phase === "docker-not-running";
    if (phase === "idle") {
      continueButton.textContent = t("Get started");
      return;
    }
    const waitingForDocker = isDockerPhase(phase);
    stackPhase.textContent =
      (waitingForDocker || phase === "failed" ? stack.message : PHASE_LABELS[phase]) ?? "";
    // Waiting for Docker is a step the person takes, not an error.
    if (phase === "failed") stackPhase.setAttribute("data-tone", "error");
    else if (phase === "ready") stackPhase.setAttribute("data-tone", "ok");
    else stackPhase.removeAttribute("data-tone");

    renderProgress(stack);
    renderDetails(stack);
    renderDockerHelp(phase);

    if (phase === "docker-missing")
      continueButton.textContent = dockerDesktop
        ? t("Download Docker Desktop")
        : t("Install Docker");
    else if (phase === "failed") continueButton.textContent = t("Try again");
    else continueButton.textContent = t("Get started");
    setBusy(!TERMINAL_PHASES.has(phase));
    if (waitingForDocker) scheduleDockerRecheck();
  }

  function renderDockerHelp(phase) {
    stackHint.hidden = phase !== "docker-missing";
    stackHint.textContent = dockerDesktop
      ? t(
          "On this Mac, Gente needs Docker Desktop (a free app) for its workspace. Install it and open it once.",
        )
      : t("Install Docker Engine and start it.");
  }

  /** Looks for Docker again on a timer, so installing or opening it is all the person has to do. */
  function scheduleDockerRecheck() {
    if (dockerRecheckTimer !== null) return;
    dockerRecheckTimer = setTimeout(() => {
      dockerRecheckTimer = null;
      if (selectedMode() !== "new" || !isDockerPhase(lastStack?.phase)) return;
      dockerRechecking = true;
      // Rendering the settled phase schedules the next look while Docker is still unavailable;
      // a look whose start or state read failed schedules its own, so polling never just stops.
      bridge.stack
        .start()
        .then(() => followStack())
        .catch(() => undefined)
        .finally(() => {
          if (stackPolling || selectedMode() !== "new" || !isDockerPhase(lastStack?.phase)) return;
          dockerRechecking = false;
          scheduleDockerRecheck();
        });
    }, DOCKER_RECHECK_MS);
  }

  /** One "Name: value" per line; null when a line has no name. The main process validates the rest. */
  function readHeaders() {
    const headers = {};
    for (const line of serverHeaders.value.split("\n")) {
      if (line.trim() === "") continue;
      const colon = line.indexOf(":");
      if (colon <= 0) return null;
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return headers;
  }

  async function save(mode, url, headers) {
    const generation = ++requestGeneration;
    // Locking the address blurs it; a failed save hands focus back so Enter can retry.
    const focused = document.activeElement;
    setBusy(true);
    lockChoice(true);
    setStatus(t("Connecting…"));
    try {
      const saved = await bridge.save({ mode, serverUrl: url, ...(headers ? { headers } : {}) });
      if (!saved.ok) setStatus(saved.error ?? t("Could not save that address."), "error");
    } catch {
      setStatus(t("Could not save that address. Try again."), "error");
    } finally {
      lockChoice(false);
      if (focused instanceof HTMLElement && document.activeElement === document.body)
        focused.focus();
      // A newer run may own the controls by now; only their owner unlocks them.
      if (generation === requestGeneration) setBusy(false);
    }
  }

  /** Wakes on the next pushed state, and on the timer if a push is ever missed. */
  function waitForStackChange() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (wakePoll === finish) wakePoll = null;
        resolve();
      };
      wakePoll = finish;
      setTimeout(finish, STACK_POLL_MS);
    });
  }

  /**
   * Follows a start already in flight until it settles. Leaving "This computer"
   * ends the follow so the stack becoming ready never saves over that choice.
   */
  async function followStack() {
    if (stackPolling) return;
    stackPolling = true;
    try {
      while (true) {
        const stack = await bridge.stack.state();
        if (stack === null) throw new Error("Setup is not active");
        // Checked after the await: a mode change during it hands the form to the change
        // handler, and a save it started must stay busy and must not be re-rendered over.
        if (selectedMode() !== "new") return;
        renderStack(stack);
        if (TERMINAL_PHASES.has(stack.phase)) {
          if (stack.phase === "ready" && selectedMode() === "new") {
            const current = await bridge.state();
            if (selectedMode() !== "new") return;
            defaultLocalUrl = current.defaultLocalUrl;
            await save("new", defaultLocalUrl);
          }
          return;
        }
        await waitForStackChange();
      }
    } catch {
      // Only report a follow the person still sees; leaving "new" already handed the form back.
      if (selectedMode() === "new") {
        setStatus(t("Could not follow the local stack. Try again."), "error");
        setBusy(false);
      }
    } finally {
      stackPolling = false;
    }
  }

  async function runStack() {
    const generation = ++requestGeneration;
    setStatus("");
    setBusy(true);
    try {
      // A queued start still reads `idle`; leave the panel as it is and let the follow render it.
      const started = await bridge.stack.start();
      // The person left "This computer" mid-start; the next pushed state re-attaches the follow.
      if (generation !== requestGeneration) return;
      if (started !== null && started.phase !== "idle") renderStack(started);
    } catch {
      if (generation === requestGeneration) {
        setStatus(t("Could not start the local stack. Try again."), "error");
        setBusy(false);
      }
      return;
    }
    await followStack();
  }


  // ---- Gente: the local Swift model -------------------------------------------------------
  let lastBrain = null;
  let brainWaiter = null;
  let chosenModel = null;

  function renderModelChoices(state) {
    if (brainModelList.childElementCount > 0) return;
    for (const model of state.models) {
      const label = document.createElement("label");
      label.className = "model";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "swift-model";
      input.value = model.tag;
      input.checked = model.tag === (chosenModel ?? state.model.tag);
      input.addEventListener("change", () => {
        chosenModel = model.tag;
        renderBrain({ ...(lastBrain ?? state), model });
      });
      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "model-name";
      name.textContent = `${model.name} · ${model.sizeGB} GB`;
      const note = document.createElement("span");
      note.className = "model-note";
      note.textContent = ` ${model.note}`;
      text.append(name, document.createElement("br"), note);
      label.append(input, text);
      brainModelList.append(label);
    }
  }

  function renderBrain(state) {
    lastBrain = state;
    renderModelChoices(state);
    if (chosenModel === null) {
      for (const input of brainModelList.querySelectorAll("input")) input.checked = input.value === state.model.tag;
    }
    const { phase, model } = state;
    brainSize.textContent = `${model.name} · ${model.sizeGB} GB`;
    brainModels.hidden = busyBrain || !["checking", "failed", "ollama-missing", "ready"].includes(phase);
    stepBrain.dataset.state =
      phase === "ready"
        ? "done"
        : phase === "failed"
          ? "error"
          : phase === "ollama-missing" || (phase === "checking" && !busyBrain)
            ? "todo"
            : "active";
    const percent =
      state.totalBytes > 0 ? Math.min(100, (state.completedBytes / state.totalBytes) * 100) : 0;
    const showBar = phase === "pulling" || phase === "installing-ollama";
    brainProgress.hidden = !showBar;
    brainProgressFill.style.width = `${percent.toFixed(1)}%`;
    brainProgress.setAttribute("aria-valuenow", percent.toFixed(1));
    brainStatus.removeAttribute("data-tone");
    let detail = "";
    switch (phase) {
      case "checking":
        brainStatus.textContent = busyBrain
          ? t("Checking this Mac…")
          : `${model.note} ${t("Downloads once, then works offline.")}`;
        break;
      case "ollama-missing":
        brainStatus.textContent = t("Gente runs Swift with Ollama, a free app. Get started installs it for you.");
        break;
      case "installing-ollama":
        brainStatus.textContent = t("Installing Ollama…");
        break;
      case "starting-ollama":
        brainStatus.textContent = t("Starting Ollama…");
        break;
      case "pulling":
        brainStatus.textContent = t("Downloading {name}…", { name: model.name });
        if (state.totalBytes > 0)
          detail = `${formatBytes(state.completedBytes)} of ${formatBytes(state.totalBytes)} · ${percent.toFixed(0)}%`;
        break;
      case "loading":
        brainStatus.textContent = t("Waking up {name}…", { name: model.name });
        detail = t("The first load can take a minute.");
        break;
      case "ready":
        brainStatus.textContent = t("{name} is ready on this Mac.", { name: model.name });
        brainStatus.setAttribute("data-tone", "ok");
        break;
      case "failed":
        brainStatus.textContent = state.message || t("Something went wrong.");
        brainStatus.setAttribute("data-tone", "error");
        break;
    }
    if (state.switchedFrom && phase !== "failed")
      detail = t("Switched to {name} for your computer ({from} could not run here).", {
        name: model.name,
        from: state.switchedFrom,
      });
    brainDetail.textContent = detail;
    if (phase === "installing-ollama" && state.totalBytes > 0)
      brainDetail.textContent = `${formatBytes(state.completedBytes)} of ${formatBytes(state.totalBytes)}`;
    if (["ready", "failed", "ollama-missing"].includes(phase) && brainWaiter !== null) {
      const resolve = brainWaiter;
      brainWaiter = null;
      resolve(state);
    }
  }

  let busyBrain = false;
  async function runBrainThenStack() {
    // A different model picked after setup runs the model step again.
    if (lastBrain?.phase === "ready" && (chosenModel === null || chosenModel === lastBrain.model.tag)) {
      await runStack();
      return;
    }
    busyBrain = true;
    setBusy(true);
    lockChoice(true);
    setStatus("");
    const settled = new Promise((resolve) => {
      brainWaiter = resolve;
    });
    try {
      const started = await bridge.brain.start({
        installOllama: true,
        ...(chosenModel ? { model: chosenModel } : {}),
      });
      renderBrain(started);
    } catch {
      brainWaiter = null;
      busyBrain = false;
      lockChoice(false);
      setBusy(false);
      setStatus(t("Could not start the model setup. Try again."), "error");
      return;
    }
    const result = await settled;
    busyBrain = false;
    lockChoice(false);
    if (result.phase === "ready") {
      await runStack();
    } else {
      setBusy(false);
      continueButton.textContent = t("Try again");
      renderBrain(result);
    }
  }

  async function check() {
    const value = serverUrl.value;
    if (value.trim() === "") {
      setStatus(t("Enter a server address first."), "error");
      return null;
    }
    const headers = readHeaders();
    if (headers === null) {
      setStatus(t("Invalid custom headers"), "error");
      return null;
    }

    const generation = ++requestGeneration;
    activeCheck = generation;
    setBusy(true);
    setStatus(t("Checking…"));
    try {
      const result = await bridge.test(value, headers);
      // The address or the mode changed under the test, so its result speaks for neither.
      if (generation !== requestGeneration) return result;
      if (result.ok) {
        serverUrl.value = result.url;
        setStatus(t("Gente answered at {url}.", { url: result.url }), "ok");
      } else {
        setStatus(result.error ?? t("Could not reach that address."), "error");
      }
      return result;
    } catch {
      if (generation === requestGeneration) {
        setStatus(t("Could not run the connection check. Try again."), "error");
      }
      return null;
    } finally {
      if (activeCheck === generation) activeCheck = 0;
      // Only the run that still owns the controls may unlock them.
      if (generation === requestGeneration) setBusy(false);
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "mode") {
      requestGeneration++;
      // The interrupted check completes stale and stays silent, so retire its lock here.
      const interruptedCheck = activeCheck !== 0;
      activeCheck = 0;
      syncPanels();
      // Unlock immediately when nothing on this mode owns the controls; followStack exits on its
      // next poll.
      if (selectedMode() !== "new" || interruptedCheck) setBusy(false);
      // Coming back to a stack still waiting for Docker resumes the look for it. Any other stack
      // waits for Continue, which follows it again and saves it once it is ready.
      if (selectedMode() === "new" && lastStack !== null && isDockerPhase(lastStack.phase)) {
        renderStack(lastStack);
      }
    }
  });

  function retireCheck() {
    // An edited address invalidates the pending check; retire it and hand the controls back so
    // its late result changes nothing.
    if (activeCheck === 0) return;
    requestGeneration++;
    activeCheck = 0;
    setStatus("");
    setBusy(false);
  }
  serverUrl.addEventListener("input", retireCheck);
  serverHeaders.addEventListener("input", retireCheck);

  checkButton.addEventListener("click", () => {
    void check();
  });

  stackDetails.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    detailsOpenedByFailure = false;
    if (lastStack !== null) renderDetails(lastStack);
  });

  quitButton.addEventListener("click", () => {
    if (bridge === undefined) {
      window.close();
      return;
    }
    void bridge.quit();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = selectedMode();
    // Without Docker the main button is the download; setup keeps looking for Docker meanwhile.
    if (mode === "new" && lastStack?.phase === "docker-missing")
      void bridge.openLink("docker-download");
    else if (mode === "new") void runBrainThenStack();
    else {
      const headers = readHeaders();
      if (headers === null) setStatus(t("Invalid custom headers"), "error");
      else void save("existing", serverUrl.value, headers);
    }
  });

  /** Pushed state keeps progress moving even when the OS throttles this window's timers. */
  function watchStack() {
    bridge.stack.onChange(() => {
      wakePoll?.();
      // A follow that ended on an error restarts here instead of leaving the panel frozen;
      // hold the controls until it has rendered the state it is restarting on.
      if (!stackPolling && selectedMode() === "new") {
        // A background look for Docker keeps the download button usable.
        if (!dockerRechecking) setBusy(true);
        void followStack();
      }
    });
  }

  advancedButton.addEventListener("click", () => {
    const next = selectedMode() === "new" ? "existing" : "new";
    document.getElementById(`mode-${next}`).checked = true;
    form.dispatchEvent(new Event("change", { bubbles: true }));
    // The change handler reads the event target; mirror it directly.
    requestGeneration++;
    activeCheck = 0;
    syncPanels();
    setBusy(false);
    if (next === "existing") serverUrl.focus();
  });

  async function init() {
    if (bridge === undefined) {
      setStatus(t("Setup bridge unavailable."), "error");
      setBusy(true);
      return;
    }

    watchStack();
    bridge.brain.onChange((state) => renderBrain(state));
    try {
      renderBrain(await bridge.brain.state());
    } catch {
      // The model step shows its default text.
    }
    // Continue needs the Cloud address and any saved choice before it can submit.
    setBusy(true);
    try {
      const state = await bridge.state();
      if (state === null) throw new Error("Setup is not active");
      defaultLocalUrl = state.defaultLocalUrl;
      cloudUrl = state.cloudUrl;
      if (state.saved !== null) {
        const mode = state.saved.mode;
        const modeInput = document.querySelector(`input[name="mode"][value="${mode}"]`);
        if (modeInput !== null) modeInput.checked = true;
        if (mode === "existing") serverUrl.value = state.saved.serverUrl;
        if (mode === "existing" && state.saved.headers) {
          serverHeaders.value = Object.entries(state.saved.headers)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n");
          serverHeadersSection.open = true;
        }
      }
      // A relaunch with the stack down starts it before this window opens; show that
      // attempt instead of the saved mode, and follow it while it is still running.
      const stack = await bridge.stack.state();
      const attached = stack !== null && stack.phase !== "idle";
      if (attached) document.getElementById("mode-new").checked = true;
      syncPanels();
      setBusy(false);
      if (state.error) setStatus(state.error, "error");
      if (attached) {
        renderStack(stack);
        if (!TERMINAL_PHASES.has(stack.phase)) void followStack();
      } else if (selectedMode() === "existing") {
        serverUrl.focus();
      } else {
        continueButton.focus();
      }
    } catch {
      setStatus(t("Setup could not start. Quit Gente and try again."), "error");
      setBusy(true);
    }
  }

  void init();
})();
