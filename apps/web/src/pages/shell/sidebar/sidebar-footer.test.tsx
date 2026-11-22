// @vitest-environment jsdom
import type { DesktopUpdateState } from "@rakazo/contracts";
import { Toaster } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdatesProvider } from "../../../components/DesktopUpdates";
import { SidebarFooter, sidebarMarkCount } from "./sidebar-footer";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.rakazoDesktop;
  vi.restoreAllMocks();
});
async function render(
  name = "Demo User",
  image?: string,
  onIntegrations = vi.fn(),
  onBoard?: () => void,
  logos?: Array<{ name: string; logo?: string }>,
) {
  const email = "account@rakazo.test";
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          logos={logos}
          name={name}
          initials={name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
          image={image}
          email={email}
          open
          onOpenChange={() => {}}
          onIntegrations={onIntegrations}
          onSkills={vi.fn()}
          onBoard={onBoard}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
        />
        <Toaster />
      </DesktopUpdatesProvider>,
    ),
  );
}
function bridge(phase: DesktopUpdateState["phase"], extra: Partial<DesktopUpdateState> = {}) {
  const state: DesktopUpdateState = {
    phase,
    currentVersion: "0.1.0",
    availableVersion: "0.2.0",
    percent: null,
    message: null,
    checkedAt: null,
    ...extra,
  };
  const install = vi.fn(async () => state);
  const updateNow = vi.fn(async () => state);
  const moveToApplications = vi.fn(async () => state);
  window.rakazoDesktop = {
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
      install,
      download: async () => state,
      check: async () => state,
      updateNow,
      moveToApplications,
    },
  };
  return { install, updateNow, moveToApplications };
}
const updateButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="sidebar-update"]');
it("hides update controls without a desktop bridge", async () => {
  await render();
  expect(updateButton()).toBeNull();
});
it.each(["unsupported", "idle", "checking"] as const)(
  "offers no update in phase %s",
  async (phase) => {
    // A background check starts from "nothing found", so no version is known yet.
    bridge(phase, phase === "checking" ? { availableVersion: null } : {});
    await render();
    expect(updateButton()).toBeNull();
  },
);
it.each(["available", "ready"] as const)(
  "offers one Update to vX button in phase %s that runs the whole update",
  async (phase) => {
    const { updateNow, install } = bridge(phase);
    await render("Ada Lovelace");
    await vi.waitFor(() => expect(updateButton()?.textContent).toBe("Update to v0.2.0"));
    await act(async () => updateButton()!.click());
    expect(updateNow).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
  },
);
it("shows download progress while updating", async () => {
  bridge("downloading", { percent: 42 });
  await render();
  await vi.waitFor(() => expect(updateButton()?.textContent).toBe("Updating… 42%"));
  expect(updateButton()!.disabled).toBe(true);
});
it("shows one plain sentence and Try again after a failure", async () => {
  const { updateNow } = bridge("error", {
    message: "The update could not be completed. Try again later.",
  });
  await render();
  await vi.waitFor(() => expect(updateButton()?.textContent).toBe("Try again"));
  expect(
    document.querySelector('[data-testid="sidebar-update-row"] [role="status"]')?.textContent,
  ).toBe("The update could not be completed. Try again later.");
  await act(async () => updateButton()!.click());
  expect(updateNow).toHaveBeenCalledTimes(1);
});
it("keeps the old version message when the update call itself fails", async () => {
  const { updateNow } = bridge("available");
  updateNow.mockRejectedValueOnce(new Error("offline"));
  await render();
  await vi.waitFor(() => expect(updateButton()).not.toBeNull());
  await act(async () => updateButton()!.click());
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="sidebar-update-row"] [role="status"]')?.textContent,
    ).toBe("The update did not finish. Your current version is still here."),
  );
  expect(updateButton()?.textContent).toBe("Try again");
});
it("offers one Move to Applications button when the Mac app runs from a disk image", async () => {
  const { moveToApplications, updateNow } = bridge("unsupported", {
    availableVersion: null,
    message: "Move Your AI to Applications to install updates.",
    fix: "move-to-applications",
  });
  await render();
  await vi.waitFor(() => expect(updateButton()?.textContent).toBe("Move to Applications"));
  await act(async () => updateButton()!.click());
  expect(moveToApplications).toHaveBeenCalledTimes(1);
  expect(updateNow).not.toHaveBeenCalled();
});
it("shows the account image and falls back to the initial after a load error", async () => {
  await render("Ada Lovelace", "https://example.test/avatar.png");
  const trigger = host.querySelector('[data-testid="user-menu-trigger"]')!;
  const image = trigger.querySelector("img")!;
  expect(image.src).toBe("https://example.test/avatar.png");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(trigger.querySelector("img")).toBeNull();
  expect(trigger.textContent).toBe("AL");
});

it("opens integrations and keeps the existing account actions and links", async () => {
  const onIntegrations = vi.fn();
  await render("Demo User", undefined, onIntegrations, vi.fn());
  const connect = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => connect.click());
  expect(onIntegrations).toHaveBeenCalledOnce();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect([...menu.querySelectorAll("button, a")].map((row) => row.textContent)).toEqual([
    "Settings",
    "Skills",
    "Artifacts",
    "Board",
    "Docs",
    "Log out",
  ]);
  expect(host.querySelector('[data-testid="user-menu-trigger"]')?.getAttribute("aria-label")).toBe(
    "Account menu for Demo User",
  );
});
it("omits Board when unavailable", async () => {
  await render();
  expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain(
    "Board",
  );
});

it("links Docs to Your AI's help and offers no mobile app (QA-018)", async () => {
  await render();
  const links = [...document.querySelectorAll("a")];
  expect(links.find((link) => link.textContent === "Get the mobile app")).toBeUndefined();
  expect(links.find((link) => link.textContent === "Docs")?.href).toBe(
    "https://github.com/LuisSantiagoLopez/gente/blob/main/docs/help/getting-started.md",
  );
});

it("falls back when app artwork fails and accepts replacement artwork", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/slack.svg" },
  ]);
  const pill = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => pill.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(pill.querySelector("img")).toBeNull();
  expect(pill.textContent).toContain("S");
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/new-slack.svg" },
  ]);
  expect(pill.querySelector("img")?.src).toBe("https://example.test/new-slack.svg");
});
it.each([
  [-20, 0],
  [0, 0],
  [25, 0],
  [26, 1],
  [47, 1],
  [48, 2],
  [69, 2],
  [70, 3],
  [200, 3],
])("fits marks into %ipx without consuming label or padding space", (width, count) => {
  expect(sidebarMarkCount(width)).toBe(count);
});

it("keeps at most three marks with the same tile and a missing-logo fallback", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Gmail", logo: "https://example.test/gmail.svg" },
    { name: "Notion" },
    { name: "GitHub", logo: "https://example.test/github.svg" },
    { name: "Slack" },
  ]);
  const tiles = [...host.querySelectorAll("[data-logo-tile]")];
  expect(tiles).toHaveLength(3);
  expect(new Set(tiles.map((tile) => tile.className)).size).toBe(1);
  expect(tiles[1]!.textContent).toBe("N");
});

const personal = {
  id: "org-personal",
  name: "Personal",
  defaultSpaceId: "s1",
  spaceIds: ["s1"],
  canManage: true,
  role: "owner" as const,
  memberCount: 1,
};
const work = {
  id: "org-work",
  name: "Work",
  defaultSpaceId: "s2",
  spaceIds: ["s2"],
  canManage: true,
  role: "owner" as const,
  memberCount: 1,
};

async function renderOrganizations(
  organizations: (typeof personal)[],
  onSwitchOrganization = vi.fn(),
  onCreateOrganization = vi.fn(),
) {
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          name="Demo User"
          initials="DU"
          email="account@rakazo.test"
          open
          onOpenChange={() => {}}
          onIntegrations={() => {}}
          onSkills={() => {}}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
          organizations={organizations}
          activeOrganizationId="org-personal"
          onSwitchOrganization={onSwitchOrganization}
          onCreateOrganization={onCreateOrganization}
        />
      </DesktopUpdatesProvider>,
    ),
  );
  return [...document.querySelector('[data-slot="popover-content"]')!.querySelectorAll("button")];
}

async function openOrganizations() {
  await act(async () =>
    (document.querySelector('[data-testid="organization-menu-trigger"]') as HTMLElement).click(),
  );
  const menus = document.querySelectorAll('[data-slot="popover-content"]');
  return [...menus[menus.length - 1]!.querySelectorAll("button")];
}

it("shows the active organization as one row, even when it is the only one", async () => {
  const rows = await renderOrganizations([personal]);
  expect(rows.map((row) => row.textContent).slice(0, 2)).toEqual(["Personal", "Settings"]);
});

it("lists organizations in a submenu with the active one checked, then New organization", async () => {
  const onSwitch = vi.fn();
  const onCreate = vi.fn();
  const rows = await renderOrganizations([personal, work], onSwitch, onCreate);
  expect(rows.map((row) => row.textContent).slice(0, 2)).toEqual(["Personal", "Settings"]);
  const items = await openOrganizations();
  expect(items.map((item) => item.textContent)).toEqual(["Personal", "Work", "New organization"]);
  expect(items[0]!.getAttribute("aria-current")).toBe("true");
  expect(items[0]!.querySelector("svg")).not.toBeNull();
  expect(items[1]!.hasAttribute("aria-current")).toBe(false);
  expect(items[1]!.querySelector("svg")).toBeNull();
  await act(async () => items[1]!.click());
  expect(onSwitch).toHaveBeenCalledWith(work);
  await act(async () => items[2]!.click());
  expect(onCreate).toHaveBeenCalled();
});
