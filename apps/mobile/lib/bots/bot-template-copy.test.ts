import { BOT_TEMPLATES, MONEY_RECIPES } from "@rakazo/core";
import { afterEach, describe, expect, it } from "vitest";
import { resetI18nForTests } from "../i18n/i18n";
import { botTemplateCopy } from "./bot-template-copy";

afterEach(() => resetI18nForTests());

// Gente: recipes ship in English, Spanish and Portuguese first; other languages follow.
const recipes = new Set(MONEY_RECIPES.map((recipe) => recipe.id));
const TRANSLATED = BOT_TEMPLATES.filter((template) => !recipes.has(template.id));

describe("botTemplateCopy", () => {
  it("matches the server's English for every template", () => {
    resetI18nForTests("en");
    for (const template of BOT_TEMPLATES) {
      expect(botTemplateCopy(template)).toEqual({
        name: template.name,
        summary: template.summary,
        sample: template.sample,
      });
    }
  });

  it("translates every template", () => {
    resetI18nForTests("de");
    for (const template of TRANSLATED) {
      const copy = botTemplateCopy(template);
      expect(copy.summary).not.toBe(template.summary);
      expect(copy.sample).not.toBe(template.sample);
    }
  });

  it("translates every recipe into Spanish and Portuguese", () => {
    for (const locale of ["es", "pt-BR"] as const) {
      resetI18nForTests(locale);
      for (const recipe of MONEY_RECIPES) {
        const copy = botTemplateCopy(recipe);
        expect(copy.name, `${locale} ${recipe.id}`).not.toBe(recipe.name);
        expect(copy.summary, `${locale} ${recipe.id}`).not.toBe(recipe.summary);
        expect(copy.sample, `${locale} ${recipe.id}`).not.toBe(recipe.sample);
      }
    }
  });

  it("shows the server's English for a template it does not know", () => {
    resetI18nForTests("de");
    const template = { ...BOT_TEMPLATES[0]!, id: "new-template", name: "New", summary: "S" };
    expect(botTemplateCopy(template)).toMatchObject({ name: "New", summary: "S" });
  });
});
