import { describe, expect, it } from "vitest";
import { shellDeletesInBulk } from "./shell-deletes.js";

describe("shellDeletesInBulk", () => {
  it("flags deletes that wipe more than one named thing", () => {
    for (const command of [
      "rm config.json notes.txt q3_sales.csv todo.md",
      "rm -rf shared/",
      "rm -r build",
      "sudo rm --recursive old",
      "rm *.log",
      "cd shared && rm -f a.txt b.txt",
      "find . -name '*.tmp' -delete",
      "find . -type f -exec rm {} +",
      "git clean -fdx",
      "ls *.bak | xargs rm",
    ]) {
      expect(shellDeletesInBulk(command), command).toBe(true);
    }
  });

  it("leaves one named file and everything else free", () => {
    for (const command of [
      "rm water_reminder_notes.md",
      "rm -f /tmp/out.txt",
      "rmdir empty",
      "python3 app.py",
      "ls -la",
      "grep -r rm .",
      "echo rm -rf /",
      "git status",
      "find . -name '*.py'",
    ]) {
      expect(shellDeletesInBulk(command), command).toBe(false);
    }
  });
});
