import { describe, expect, it } from "vitest";
import { screenActionRisk, screenElementLabels } from "./screen-action-risk.js";

const click = (element: number) => ({ kind: "click", element });

describe("screenActionRisk", () => {
  it.each([
    ["Buy the concert tickets", "money"],
    ["Pay now with the saved card", "money"],
    ["Place your order", "money"],
    ["Send the reply to Ana", "send"],
    ["Post the update to the team channel", "send"],
    ["Move the old drafts to the trash", "delete"],
    ["Delete the duplicate photos", "delete"],
    ["Accept the terms and continue", "legal"],
    ["I agree to the license", "legal"],
    ["Sign the contract", "legal"],
  ] as const)("finds %s in the stated purpose", (purpose, risk) => {
    expect(screenActionRisk({ app: "Safari", actions: [click(1)], purpose })).toBe(risk);
  });

  it.each([
    "Open the latest invoice",
    "Read the unread messages",
    "Scroll to the shipping section",
    "Draft a reply but do not finish",
    "Rename the folder to Taxes",
  ])("lets ordinary work through: %s", (purpose) => {
    expect(screenActionRisk({ app: "Finder", actions: [click(1)], purpose })).toBeNull();
  });

  it("reads the names of clicked and set elements, not typed text", () => {
    const labels = new Map([
      [3, 'AXButton "Send"'],
      [4, 'AXButton "Attach file"'],
      [5, 'button "Complete purchase"'],
      [6, 'checkbox "I agree to the Terms of Service"'],
    ]);
    const risk = (actions: object[]) =>
      screenActionRisk({ app: "Mail", actions: actions as never, labels });
    expect(risk([click(3)])).toBe("send");
    expect(risk([click(4)])).toBeNull();
    expect(risk([click(5)])).toBe("money");
    expect(risk([{ kind: "set", element: 6 }])).toBe("legal");
    expect(
      risk([{ kind: "type", text: "Please delete it and send money", element: 4 }]),
    ).toBeNull();
    expect(risk([click(99)])).toBeNull();
  });

  it("reads menu paths", () => {
    expect(
      screenActionRisk({
        app: "Finder",
        actions: [{ kind: "menu", path: ["File", "Move to Trash"] }],
      }),
    ).toBe("delete");
    expect(
      screenActionRisk({
        app: "Finder",
        actions: [{ kind: "menu", path: ["File", "New Folder"] }],
      }),
    ).toBeNull();
  });

  it("treats Return as sending only in chat apps, and Cmd+Return in mail", () => {
    const key = (app: string, keyName: string, modifiers: string[] = []) =>
      screenActionRisk({ app, actions: [{ kind: "key", key: keyName, modifiers }] });
    expect(key("Messages", "return")).toBe("send");
    expect(key("Slack", "enter")).toBe("send");
    expect(key("TextEdit", "return")).toBeNull();
    expect(key("Mail", "return")).toBeNull();
    expect(key("Mail", "return", ["cmd"])).toBe("send");
    expect(key("Mail", "d", ["cmd", "shift"])).toBe("send");
    expect(key("Finder", "delete", ["cmd"])).toBe("delete");
    expect(key("File Explorer", "delete", ["shift"])).toBe("delete");
    expect(key("Notes", "delete", ["cmd"])).toBeNull();
  });

  it("names the most important risk when a call does several", () => {
    expect(
      screenActionRisk({ app: "Safari", actions: [click(1)], purpose: "Agree to terms and pay" }),
    ).toBe("money");
  });
});

describe("screenElementLabels", () => {
  it("keeps role and name by element number and drops field values", () => {
    const labels = screenElementLabels(
      '- [0] AXWindow "Reply"\n  - [1] textfield "To" = "ana@example.test"\n  - [12] AXButton "Send"\nplain row',
    );
    expect([...labels]).toEqual([
      [0, 'AXWindow "Reply"'],
      [1, 'textfield "To"'],
      [12, 'AXButton "Send"'],
    ]);
  });
});
