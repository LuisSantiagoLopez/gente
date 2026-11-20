import { describe, expect, it } from "vitest";
import { mergeThreadLedger, parseThreadLedger, renderThreadLedger } from "./thread-ledger.js";

const first = `## Decisions
- [seq 12] Ship the beta on Friday.
## Facts
- [seq 20] The project code name is MARIGOLD-7.
- [seq 31] Ana owns the budget.
## Open loops
- [seq 40] Send the invoice to Acme.
## Preferences
- [seq 5] Replies in Spanish, short.
## Recent story
We planned the beta.`;

describe("parseThreadLedger", () => {
  it("reads sections, bullets and seq citations", () => {
    const ledger = parseThreadLedger(first)!;
    expect(ledger.sections.Facts).toEqual([
      { text: "[seq 20] The project code name is MARIGOLD-7.", seqs: [20] },
      { text: "[seq 31] Ana owns the budget.", seqs: [31] },
    ]);
    expect(ledger.sections["Open loops"][0]!.seqs).toEqual([40]);
    expect(ledger.story).toBe("We planned the beta.");
  });

  it("reads ranges, lists of seqs and wrapped lines", () => {
    const ledger = parseThreadLedger(
      "## Facts:\n- [seqs 3, 7-9] Long item\n  that wraps.\n- (none)",
    )!;
    expect(ledger.sections.Facts).toEqual([
      { text: "[seqs 3, 7-9] Long item that wraps.", seqs: [3, 7, 9] },
    ]);
  });

  it("returns null for plain prose", () => {
    expect(parseThreadLedger("We talked about the beta.")).toBeNull();
    expect(parseThreadLedger("")).toBeNull();
  });
});

describe("mergeThreadLedger", () => {
  it("carries forward items the model dropped", () => {
    const next = `## Decisions\n- [seq 60] Use the blue logo.\n## Recent story\nLogo talk.`;
    const merged = parseThreadLedger(mergeThreadLedger(first, next, 20_000))!;
    expect(merged.sections.Facts.map((item) => item.seqs[0])).toEqual([20, 31]);
    expect(merged.sections.Decisions.map((item) => item.seqs[0])).toEqual([12, 60]);
    expect(merged.sections["Open loops"]).toHaveLength(1);
    expect(merged.story).toBe("Logo talk.");
  });

  it("drops items marked resolved or superseded", () => {
    const next = `## Resolved\n- [seq 40] Invoice sent.\n## Superseded\n- [seq 12] Beta moved to Monday.\n## Decisions\n- [seq 70] Ship the beta on Monday.`;
    const merged = parseThreadLedger(mergeThreadLedger(first, next, 20_000))!;
    expect(merged.sections["Open loops"]).toEqual([]);
    expect(merged.sections.Decisions.map((item) => item.text)).toEqual([
      "[seq 70] Ship the beta on Monday.",
    ]);
  });

  it("replaces a reworded item about the same message without duplicating it", () => {
    const next = "## Facts\n- [seq 31] Ana owns the whole budget.";
    const merged = parseThreadLedger(mergeThreadLedger(first, next, 20_000))!;
    expect(merged.sections.Facts.map((item) => item.text)).toEqual([
      "[seq 20] The project code name is MARIGOLD-7.",
      "[seq 31] Ana owns the whole budget.",
    ]);
  });

  it("keeps two different facts from the same message", () => {
    const previous = "## Facts\n- [seq 8] The office is in Lima.";
    const next = "## Facts\n- [seq 8] The team has nine people.";
    const merged = parseThreadLedger(mergeThreadLedger(previous, next, 20_000))!;
    expect(merged.sections.Facts).toHaveLength(2);
  });

  it("keeps the previous ledger when the model answers in prose", () => {
    const merged = parseThreadLedger(
      mergeThreadLedger(first, "Just chatted about lunch.", 20_000),
    )!;
    expect(merged.sections.Facts).toHaveLength(2);
    expect(merged.story).toBe("Just chatted about lunch.");
  });

  it("returns prose unchanged when there was never a ledger", () => {
    expect(mergeThreadLedger(null, "Plain summary.", 100)).toBe("Plain summary.");
  });

  it("stays under the cap, keeping open loops and newest items", () => {
    const facts = Array.from(
      { length: 200 },
      (_, index) => `- [seq ${index}] Fact number ${index}.`,
    );
    const previous = `## Facts\n${facts.join("\n")}\n## Open loops\n- [seq 1] Call the bank.`;
    const merged = mergeThreadLedger(previous, "## Recent story\nA lot happened.", 1_500);
    expect(merged.length).toBeLessThanOrEqual(1_500);
    const ledger = parseThreadLedger(merged)!;
    expect(ledger.sections["Open loops"]).toHaveLength(1);
    expect(ledger.sections.Facts.at(-1)!.seqs).toEqual([199]);
    expect(ledger.sections.Facts.some((item) => item.seqs[0] === 0)).toBe(false);
  });

  it("renders every section so the model sees where to write", () => {
    const rendered = renderThreadLedger(parseThreadLedger("## Facts\n- x")!);
    expect(rendered).toContain("## Decisions\n- (none)");
    expect(rendered).toContain("## Facts\n- x");
  });
});
