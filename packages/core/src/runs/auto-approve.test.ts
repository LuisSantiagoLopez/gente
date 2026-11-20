import type { AutoApproveLimits } from "@rakazo/contracts";
import { DEFAULT_AUTO_APPROVE_LIMITS } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { actionRecipients, alwaysAskCategory, autoApproveCovers } from "./auto-approve.js";

const limits: AutoApproveLimits = {
  enabled: true,
  perTaskMinor: 5_000,
  perMonthMinor: 20_000,
  currency: "usd",
  contacts: ["maria@example.com"],
  apps: ["googlecalendar"],
};
const nothingSpent = { task: 0, month: 0 };
const owner = { tainted: false, mandatory: false, spent: nothingSpent };
const pay = (minor: number, currency = "usd") => ({
  recipients: [],
  connectorKinds: [],
  payment: { minor, currency },
});

describe("alwaysAskCategory", () => {
  const kind = (toolName: string, slugs: string[] = [], recipients: string[] = []) =>
    alwaysAskCategory({ toolName, slugs, recipients, pays: false, deletesInBulk: false });

  it("finds the four kinds in built-ins and connector actions", () => {
    expect(kind("paid_request")).toBe("spend");
    expect(kind("x", ["STRIPE_CREATE_CHARGE"])).toBe("spend");
    expect(kind("send_email")).toBe("send");
    expect(kind("x", ["GMAIL_SEND_EMAIL"])).toBe("send");
    expect(kind("x", ["SLACK_POST_MESSAGE"])).toBe("send");
    expect(kind("delete_email")).toBe("delete");
    expect(kind("x", ["GMAIL_DELETE_MESSAGE"])).toBe("delete");
    expect(kind("x", ["DOCUSIGN_SIGN_ENVELOPE"])).toBe("legal");
    expect(
      alwaysAskCategory({
        toolName: "browser_act",
        slugs: [],
        recipients: [],
        pays: true,
        deletesInBulk: false,
      }),
    ).toBe("spend");
    expect(
      alwaysAskCategory({
        toolName: "shell",
        slugs: [],
        recipients: [],
        pays: false,
        deletesInBulk: true,
      }),
    ).toBe("delete");
  });

  it("counts a connector write that invites people as a send", () => {
    expect(kind("x", ["GOOGLECALENDAR_CREATE_EVENT"], ["ana@example.com"])).toBe("send");
    expect(kind("x", ["GOOGLECALENDAR_CREATE_EVENT"])).toBeUndefined();
  });

  it("leaves reads and other work alone", () => {
    expect(kind("x", ["GMAIL_FETCH_MESSAGE_BY_THREAD_ID"])).toBeUndefined();
    expect(kind("x", ["REDDIT_GET_POST"])).toBeUndefined();
    expect(kind("schedule_create")).toBeUndefined();
    expect(kind("archive_bot")).toBeUndefined();
    expect(kind("write_file")).toBeUndefined();
  });
});

describe("autoApproveCovers", () => {
  it("passes nothing by default", () => {
    expect(autoApproveCovers(DEFAULT_AUTO_APPROVE_LIMITS, pay(1), owner)).toBe(false);
    expect(
      autoApproveCovers(
        undefined,
        { recipients: ["maria@example.com"], connectorKinds: [] },
        owner,
      ),
    ).toBe(false);
  });

  it("passes a spend only while this task and this month stay within the caps", () => {
    expect(autoApproveCovers(limits, pay(5_000), owner)).toBe(true);
    expect(autoApproveCovers(limits, pay(5_001), owner)).toBe(false);
    expect(
      autoApproveCovers(limits, pay(2_000), { ...owner, spent: { task: 3_500, month: 0 } }),
    ).toBe(false);
    expect(
      autoApproveCovers(limits, pay(2_000), { ...owner, spent: { task: 0, month: 19_000 } }),
    ).toBe(false);
    expect(autoApproveCovers(limits, pay(100, "eur"), owner)).toBe(false);
  });

  it("never passes a spend with an unknown amount, unknown spending or a missing cap", () => {
    expect(
      autoApproveCovers(limits, { recipients: [], connectorKinds: [], payment: "unknown" }, owner),
    ).toBe(false);
    expect(autoApproveCovers(limits, pay(1), { tainted: false, mandatory: false })).toBe(false);
    expect(autoApproveCovers({ ...limits, perMonthMinor: null }, pay(1), owner)).toBe(false);
    expect(autoApproveCovers({ ...limits, perTaskMinor: null }, pay(1), owner)).toBe(false);
  });

  it("never lets a trusted app skip the caps", () => {
    expect(
      autoApproveCovers(
        limits,
        {
          recipients: [],
          connectorKinds: ["googlecalendar"],
          payment: { minor: 9_999, currency: "usd" },
        },
        owner,
      ),
    ).toBe(false);
  });

  it("passes sends only when every recipient is a trusted contact", () => {
    const send = (recipients: string[]) => ({ recipients, connectorKinds: ["gmail"] });
    expect(autoApproveCovers(limits, send(["Maria@Example.com"]), owner)).toBe(true);
    expect(autoApproveCovers(limits, send(["maria@example.com", "other@example.com"]), owner)).toBe(
      false,
    );
    expect(autoApproveCovers(limits, send([]), owner)).toBe(false);
  });

  it("passes any action in a trusted app, and only when every app is trusted", () => {
    expect(
      autoApproveCovers(
        limits,
        { recipients: ["x@example.com"], connectorKinds: ["GoogleCalendar"] },
        owner,
      ),
    ).toBe(true);
    expect(
      autoApproveCovers(
        limits,
        { recipients: [], connectorKinds: ["googlecalendar", "gmail"] },
        owner,
      ),
    ).toBe(false);
  });

  it("never covers a run outside content entered, or an action that always needs a person", () => {
    const send = { recipients: ["maria@example.com"], connectorKinds: [] };
    expect(autoApproveCovers(limits, send, { ...owner, tainted: true })).toBe(false);
    expect(autoApproveCovers(limits, send, { ...owner, mandatory: true })).toBe(false);
  });
});

describe("actionRecipients", () => {
  it("collects addresses under recipient keys at any depth", () => {
    expect(
      actionRecipients({
        to: ["A@Example.com"],
        cc: "b@example.com, c@example.com",
        tools: [
          {
            tool_slug: "GOOGLECALENDAR_CREATE_EVENT",
            arguments: { attendees: [{ email: "d@example.com" }] },
          },
        ],
        body: "write to e@example.com",
      }),
    ).toEqual(["a@example.com", "b@example.com", "c@example.com", "d@example.com"]);
  });

  it("keeps a recipient that is not an address so it never matches a contact", () => {
    expect(actionRecipients({ recipient_email: "Maria" })).toEqual(["Maria"]);
  });
});
