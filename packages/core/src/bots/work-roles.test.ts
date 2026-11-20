import { describe, expect, it } from "vitest";
import { findBotTemplate } from "./bot-templates.js";
import { recipesForRoles, WORK_ROLES } from "./work-roles.js";

describe("work roles", () => {
  it("point only at templates that exist", () => {
    for (const recipe of WORK_ROLES.flatMap((role) => role.recipes)) {
      expect(findBotTemplate(recipe), recipe).toBeDefined();
    }
  });

  it("turn on each recipe once for several roles, and nothing for unknown ones", () => {
    expect(recipesForRoles(["freelancer", "consultant"])).toEqual([
      "proposal-writer",
      "invoice-chaser",
      "meeting-notes",
      "client-report",
    ]);
    expect(recipesForRoles(["astronaut"])).toEqual([]);
  });
});
