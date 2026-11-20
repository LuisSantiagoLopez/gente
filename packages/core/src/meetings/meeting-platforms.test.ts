import { describe, expect, it } from "vitest";
import { meetingBotName } from "./meeting-platforms.js";

describe("meeting bot name", () => {
  it("always says it is an AI assistant and whose it is", () => {
    expect(meetingBotName("Samantha Reyes")).toBe("Samantha's Your AI (AI assistant)");
    expect(meetingBotName("  ")).toBe("Your AI (AI assistant)");
    expect(meetingBotName(null)).toBe("Your AI (AI assistant)");
    expect(meetingBotName("x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
