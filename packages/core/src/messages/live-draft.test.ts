import { describe, expect, it } from "vitest";
import { reduceLiveMessageBlocks } from "./events.js";

const progress = (payload: Record<string, unknown>) => ({ type: "progress" as const, payload });

describe("live drafts", () => {
  it("streams thinking before the reply and keeps it with the text that follows", () => {
    let blocks = reduceLiveMessageBlocks([], progress({ draft: { thinking: "Let me " } }));
    blocks = reduceLiveMessageBlocks(blocks, progress({ draft: { thinking: "check." } }));
    expect(blocks).toEqual([{ kind: "progress", text: "", thinking: "Let me check." }]);
    blocks = reduceLiveMessageBlocks(blocks, progress({ text: "Sure", streaming: true }));
    blocks = reduceLiveMessageBlocks(blocks, progress({ delta: "!", streaming: true }));
    expect(blocks).toEqual([{ kind: "progress", text: "Sure!", thinking: "Let me check." }]);
  });

  it("grows a tool call's arguments and drops them once the call runs", () => {
    let blocks = reduceLiveMessageBlocks(
      [],
      progress({ draft: { tool: { name: "write_file", args: '{"content":"a' } } }),
    );
    blocks = reduceLiveMessageBlocks(
      blocks,
      progress({ draft: { tool: { name: "write_file", args: 'bc"}' } } }),
    );
    expect(blocks.at(-1)).toMatchObject({
      toolDraft: { name: "write_file", args: '{"content":"abc"}' },
    });
    blocks = reduceLiveMessageBlocks(
      blocks,
      progress({ text: "Writing a file", activity: true, streaming: true }),
    );
    expect(blocks.at(-1)).not.toHaveProperty("toolDraft");
  });

  it("clears drafts on a reset and leaves the reply text alone", () => {
    let blocks = reduceLiveMessageBlocks([], progress({ text: "Hi", streaming: true }));
    blocks = reduceLiveMessageBlocks(blocks, progress({ draft: { thinking: "hmm" } }));
    blocks = reduceLiveMessageBlocks(blocks, progress({ draft: { reset: true } }));
    expect(blocks).toEqual([{ kind: "progress", text: "Hi" }]);
  });
});
