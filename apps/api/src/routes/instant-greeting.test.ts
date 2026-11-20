// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { instantGreeting } from "./bots.js";

describe("instant greeting (QA-015)", () => {
  it("greets in the person's language with their first name", () => {
    expect(instantGreeting("es-MX", "José Núñez", "Chief")).toBe("¡Hola José! Soy Chief. Pregúntame lo que quieras o cuéntame en qué te ayudo.");
    expect(instantGreeting("pt-BR", "José", "Chief")).toMatch(/^Oi, José! Eu sou Chief/);
    expect(instantGreeting("zh-TW", "", "Chief")).toBe("你好！我是 Chief。有什麼都可以問我。");
    expect(instantGreeting(null, "Ada", "Chief")).toMatch(/^Hi Ada! I'm Chief/);
    expect(instantGreeting("xx", "Ada", "Chief")).toMatch(/^Hi Ada!/);
  });
});
