// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import {
  applyProjectChange,
  MAX_PROJECT_TIMELINE,
  newProject,
  ProjectChangeError,
  parseProject,
  projectPath,
  recordProjectRun,
  serializeProject,
} from "./projects.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T11:00:00.000Z";

describe("projects", () => {
  const base = newProject({
    id: "p1",
    name: " Launch site ",
    goals: ["Ship v1", " "],
    threadId: "th1",
    now: T0,
  });

  it("starts active with goals and its chat linked", () => {
    expect(base).toMatchObject({
      name: "Launch site",
      status: "active",
      goals: ["Ship v1"],
      threadIds: ["th1"],
    });
    expect(projectPath("p1")).toBe("projects/p1.json");
    expect(parseProject(serializeProject(base))).toEqual(base);
    expect(parseProject("{not json")).toBeNull();
    expect(parseProject('{"id":"x"}')).toBeNull();
  });

  it("logs task moves on the timeline with who moved them", () => {
    const withTask = applyProjectChange(base, { addTask: "Write copy" }, "user", T0);
    const moved = applyProjectChange(
      withTask,
      { task: { id: "t1", status: "doing" }, runId: "r1" },
      "bot",
      T1,
    );
    expect(moved.tasks).toEqual([
      { id: "t1", title: "Write copy", status: "doing", updatedAt: T1 },
    ]);
    expect(moved.timeline.map((e) => [e.by, e.kind, e.text, e.runId])).toEqual([
      ["user", "status", "Added task: Write copy", undefined],
      ["bot", "status", "Write copy: doing", "r1"],
    ]);
    const again = applyProjectChange(moved, { addTask: "Pick colors" }, "bot", T1);
    expect(again.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    // The original is untouched.
    expect(base.tasks).toEqual([]);
  });

  it("refuses an unknown task with a client error", () => {
    expect(() =>
      applyProjectChange(base, { task: { id: "t9", status: "done" } }, "bot", T1),
    ).toThrow(ProjectChangeError);
  });

  it("records feedback, links and assets once each", () => {
    let p = applyProjectChange(
      base,
      { feedback: "Logo too dark", linkBrain: "brand", linkSkill: "copy" },
      "user",
      T1,
    );
    p = applyProjectChange(
      p,
      { linkBrain: "brand", addAsset: { name: "logo.png", artifactId: "a1" } },
      "bot",
      T1,
    );
    p = applyProjectChange(p, { addAsset: { name: "logo-v2.png", artifactId: "a1" } }, "bot", T1);
    expect(p.brainSlugs).toEqual(["brand"]);
    expect(p.skillNames).toEqual(["copy"]);
    expect(p.assets).toEqual([{ name: "logo.png", artifactId: "a1" }]);
    expect(p.timeline).toEqual([{ at: T1, kind: "feedback", by: "user", text: "Logo too dark" }]);
  });

  it("adds one run entry per run and caps the timeline", () => {
    let p = recordProjectRun(base, "r1", "Drafted the hero copy", T1);
    p = recordProjectRun(p, "r1", "Drafted the hero copy", T1);
    expect(p.timeline).toHaveLength(1);
    for (let i = 0; i < MAX_PROJECT_TIMELINE + 5; i += 1)
      p = applyProjectChange(p, { note: `n${i}` }, "bot", T1);
    expect(p.timeline).toHaveLength(MAX_PROJECT_TIMELINE);
    expect(p.timeline.at(-1)!.text).toBe(`n${MAX_PROJECT_TIMELINE + 4}`);
  });
});
