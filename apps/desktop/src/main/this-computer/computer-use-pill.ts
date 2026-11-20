// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
import path from "node:path";
import { BrowserWindow, globalShortcut, screen } from "electron";
import { desktop } from "../desktop-state.js";
import { t } from "../i18n.js";
import { handleIpc } from "../ipc/ipc.js";
import type { ComputerUseIndicator } from "./computer-use.js";
import { createComputerUse, stopShortcut } from "./computer-use.js";

const WIDTH = 420;
const HEIGHT = 64;
/** The pill's exit spring, before its window hides. */
const LEAVE_MS = 280;
/** How long "Stopped" stays up. */
const STOPPED_MS = 1_400;

type PillState = "in" | "out" | "stopped";

/**
 * The small always-on-top pill that says "Gente is using your computer" while Gente drives the
 * screen, with a Stop button and a stop key that is held only while it shows. Clicks pass
 * through the pill except over its Stop button.
 */
export function createComputerUseControl(platform: NodeJS.Platform) {
  let leaveTimer: NodeJS.Timeout | undefined;
  let loadedHint: string | undefined;
  const shortcut = stopShortcut(globalShortcut, platform, () => control.stop());

  function pillWindow(hint: string) {
    let win = desktop.computerPillWindow;
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        ...(platform === "darwin" ? { type: "panel" } : {}),
        webPreferences: {
          preload: path.join(import.meta.dirname, "computer-pill-preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setIgnoreMouseEvents(true, { forward: true });
      win.on("closed", () => {
        desktop.computerPillWindow = null;
        loadedHint = undefined;
      });
      desktop.computerPillWindow = win;
    }
    if (loadedHint !== hint) {
      loadedHint = hint;
      void win.loadFile(path.join(import.meta.dirname, "computer-pill.html"), {
        query: {
          title: t("Gente is using your computer"),
          hint,
          stop: t("Stop"),
          stopped: t("Stopped"),
          state: "in",
        },
      });
    }
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds({
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: workArea.y + 8,
      width: WIDTH,
      height: HEIGHT,
    });
    return win;
  }

  function send(state: PillState) {
    const win = desktop.computerPillWindow;
    if (win && !win.isDestroyed()) win.webContents.send("desktop.computerPill.state", state);
  }

  function leaveSoon(after: number) {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      send("out");
      leaveTimer = setTimeout(() => desktop.computerPillWindow?.hide(), LEAVE_MS);
    }, after);
  }

  const indicator: ComputerUseIndicator = {
    show() {
      clearTimeout(leaveTimer);
      const key = shortcut.hold();
      const win = pillWindow(key ? t("Press {key} to stop", { key }) : "");
      win.showInactive();
      send("in");
    },
    hide() {
      shortcut.release();
      leaveSoon(0);
    },
    stopped() {
      shortcut.release();
      send("stopped");
      leaveSoon(STOPPED_MS);
    },
  };

  const control = createComputerUse({ indicator });

  handleIpc("desktop.computerPill.stop", () => {
    control.stop();
  });
  handleIpc("desktop.computerPill.hover", (_event, over) => {
    desktop.computerPillWindow?.setIgnoreMouseEvents(over !== true, { forward: true });
  });

  return {
    wrap: control.wrap,
    stop: control.stop,
    dispose() {
      clearTimeout(leaveTimer);
      shortcut.release();
      const win = desktop.computerPillWindow;
      if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
