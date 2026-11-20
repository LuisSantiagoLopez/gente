import type { AutoApproveLimits } from "@rakazo/contracts";
import { DEFAULT_AUTO_APPROVE_LIMITS } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { actionRecipients, autoApproveCovers, pageAmount } from "./auto-approve.js";

const limits: AutoApproveLimits = {
  enabled: true,
  maxAmountMinor: 5_000,
  currency: "usd",
  contacts: ["maria@example.com"],
  apps: ["googlecalendar"],
};
const owner = { tainted: false, mandatory: false };

describe("autoApproveCovers", () => {
  it("passes nothing by default", () => {
    expect(
      autoApproveCovers(
        DEFAULT_AUTO_APPROVE_LIMITS,
        { recipients: [], connectorKinds: [], payment: { minor: 1, currency: "usd" } },
        owner,
      ),
    ).toBe(false);
    expect(
      autoApproveCovers(
        undefined,
        { recipients: ["maria@example.com"], connectorKinds: [] },
        owner,
      ),
    ).toBe(false);
  });

  it("passes a purchase up to the amount in the same currency only", () => {
    const pay = (minor: number, currency = "usd") => ({
      recipients: [],
      connectorKinds: [],
      payment: { minor, currency },
    });
    expect(autoApproveCovers(limits, pay(5_000), owner)).toBe(true);
    expect(autoApproveCovers(limits, pay(5_001), owner)).toBe(false);
    expect(autoApproveCovers(limits, pay(100, "eur"), owner)).toBe(false);
    expect(
      autoApproveCovers(limits, { recipients: [], connectorKinds: [], payment: "unknown" }, owner),
    ).toBe(false);
    expect(autoApproveCovers({ ...limits, maxAmountMinor: null }, pay(1), owner)).toBe(false);
  });

  it("never lets an allowed app skip the amount", () => {
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

  it("passes sends only when every recipient is a listed contact", () => {
    expect(
      autoApproveCovers(
        limits,
        { recipients: ["Maria@Example.com"], connectorKinds: ["gmail"] },
        owner,
      ),
    ).toBe(true);
    expect(
      autoApproveCovers(
        limits,
        { recipients: ["maria@example.com", "other@example.com"], connectorKinds: ["gmail"] },
        owner,
      ),
    ).toBe(false);
    expect(autoApproveCovers(limits, { recipients: [], connectorKinds: ["gmail"] }, owner)).toBe(
      false,
    );
  });

  it("passes any action in a listed app", () => {
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
    expect(autoApproveCovers(limits, send, { tainted: true, mandatory: false })).toBe(false);
    expect(autoApproveCovers(limits, send, { tainted: false, mandatory: true })).toBe(false);
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

describe("pageAmount", () => {
  it("reads common page amounts", () => {
    expect(pageAmount("$165.00")).toEqual({ minor: 16_500, currency: "usd" });
    expect(pageAmount("$1,234.50")).toEqual({ minor: 123_450, currency: "usd" });
    expect(pageAmount("12,00 €")).toEqual({ minor: 1_200, currency: "eur" });
    expect(pageAmount("EUR 1.299,99")).toEqual({ minor: 129_999, currency: "eur" });
    expect(pageAmount("£7")).toEqual({ minor: 700, currency: "gbp" });
  });

  it("is unknown for anything else", () => {
    expect(pageAmount("")).toBe("unknown");
    expect(pageAmount("Free")).toBe("unknown");
    expect(pageAmount("$")).toBe("unknown");
  });
});
