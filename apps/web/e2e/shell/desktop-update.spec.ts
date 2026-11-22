import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "../helpers/helpers";

test("one Update button checks, updates with progress, and offers Try again after a failure", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let attempts = 0;
    let checks = 0;
    let state = {
      phase: "idle",
      currentVersion: "0.1.2",
      availableVersion: null as string | null,
      percent: null as number | null,
      message: null as string | null,
      checkedAt: "2026-01-01T00:00:00.000Z",
    };
    Object.defineProperty(window, "rakazoDesktop", {
      value: {
        platform: "darwin",
        window: {
          close: async () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
        },
        oauth: { onCallback: () => () => {} },
        update: {
          state: async () => state,
          check: async () => {
            state =
              ++checks === 1
                ? { ...state, checkedAt: "2026-01-01T00:01:00.000Z" }
                : { ...state, phase: "available", availableVersion: "0.1.3" };
            return state;
          },
          download: async () => state,
          install: async () => state,
          updateNow: async () => {
            state = { ...state, phase: "downloading", percent: 50 };
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            if (++attempts === 1) {
              state = {
                ...state,
                phase: "error",
                percent: null,
                message: "The update could not be completed. Try again later.",
              };
              return state;
            }
            state = { ...state, phase: "ready", percent: 100, message: null };
            document.documentElement.dataset.updateInstalled = "true";
            return state;
          },
        },
      },
    });
  });
  const stamp = Date.now();
  await signup(page, `desktop-update-${stamp}@rakazo.test`, "password12", "Update Tester");
  await completeOnboarding(page);
  await openUserSettings(page, "updates");
  const settings = page.getByTestId("desktop-update-settings");
  await expect(settings.getByText("v0.1.2")).toBeVisible();
  await settings.getByRole("button", { name: "Check for updates" }).click();
  await expect(settings.getByRole("status")).toHaveText("Up to date");
  await settings.getByRole("button", { name: "Check for updates" }).click();
  await settings.getByRole("button", { name: "Update to v0.1.3" }).click();
  await expect(settings.getByRole("button", { name: /Updating/ })).toBeDisabled();
  await expect(settings.getByRole("status")).toHaveText(
    "The update could not be completed. Try again later.",
  );
  await captureScreenshot(page, testInfo, "desktop-update-failed");
  await settings.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-update-installed", "true");
});
