import { describe, expect, it } from "vitest";
import { toolDraftPreview } from "./tool-draft";

describe("toolDraftPreview", () => {
  it("decodes a file body while it is still being written", () => {
    const args = '{"path": "notes/todo.md", "content": "# Todo\\n- buy \\"milk\\"\\n- ca';
    expect(toolDraftPreview(args)).toEqual({
      path: "notes/todo.md",
      body: '# Todo\n- buy "milk"\n- ca',
      isBody: true,
    });
  });

  it("stops at a cut escape instead of guessing it", () => {
    expect(toolDraftPreview('{"content":"a\\').body).toBe("a");
    expect(toolDraftPreview('{"content":"a\\u00').body).toBe("a");
    expect(toolDraftPreview('{"content":"caf\\u00e9"}').body).toBe("café");
  });

  it("shows other arguments as written", () => {
    expect(toolDraftPreview('{"query": "weather in Ma')).toEqual({
      body: '{"query": "weather in Ma',
      isBody: false,
    });
  });
});
