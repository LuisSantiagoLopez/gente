import { describe, expect, it } from "vitest";
import { HistoryIndex, indexTokens } from "./history-index.js";

describe("indexTokens", () => {
  it("folds case and accents, drops stop words, stems lightly", () => {
    expect(indexTokens("¿Cuál era el NOMBRE código del proyecto?")).toEqual([
      "nombre",
      "codigo",
      "proyecto",
    ]);
    expect(indexTokens("Meetings booked")).toEqual(["meeting", "book"]);
    expect(indexTokens("v2 build 2026")).toEqual(["v2", "build", "2026"]);
  });

  it("splits Han text into characters", () => {
    expect(indexTokens("项目代号")).toEqual(["项", "目", "代", "号"]);
  });
});

describe("HistoryIndex", () => {
  it("ranks the rare matching message first and respects beforeSeq", () => {
    const index = new HistoryIndex();
    index.add(0, "hello there");
    index.add(1, "The project code name is MARIGOLD-7, keep it secret.");
    for (let seq = 2; seq < 50; seq += 1)
      index.add(seq, `Let's talk about lunch plans number ${seq}.`);
    index.add(50, "What was the code name again?");
    expect(index.search("what was the code name?", { beforeSeq: 50, limit: 3 })[0]!.seq).toBe(1);
    expect(index.search("code name", { beforeSeq: 1, limit: 3 })).toEqual([]);
    expect(index.upToSeq).toBe(50);
    expect(index.size).toBe(51);
  });

  it("matches any term and ignores re-adds", () => {
    const index = new HistoryIndex();
    index.add(3, "Ana owns the budget");
    index.add(3, "something else");
    expect(index.search("who owns budgets", { beforeSeq: 10, limit: 5 })).toHaveLength(1);
    expect(index.search("unrelated words", { beforeSeq: 10, limit: 5 })).toEqual([]);
  });

  it("matches Spanish queries without accents", () => {
    const index = new HistoryIndex();
    index.add(1, "La reunión con Acme es el martes");
    index.add(2, "Comimos tacos");
    expect(index.search("reunion acme", { beforeSeq: 9, limit: 1 })[0]!.seq).toBe(1);
  });
});
