// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { guardsActionClaims, quickChatBody } from "./burrow-fast-chat.js";
import {
  claimsAction,
  guardActionClaims,
  HONESTY_RULE,
  toolRanThisTurn,
  USE_TOOLS_NOTE,
  withUseToolsNote,
} from "./gente-honest-actions.js";

const sse = (...chunks: Array<Record<string, unknown>>) =>
  new Response(
    `${chunks
      .map((delta) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`)
      .join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );

async function read(response: Response) {
  const text = await response.text();
  const content: string[] = [];
  let toolCalls = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string") content.push(delta.content);
    if (delta.tool_calls) toolCalls++;
  }
  return { content: content.join(""), toolCalls };
}

const call = (name: string) => ({
  tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: "{}" } }],
});

describe("claims of actions no tool did", () => {
  it.each([
    "I'm creating your coffee shop website now.",
    "I've published the site.",
    "Done! Your website is live.",
    "Estoy creando tu página web ahora mismo.",
    "Listo, creé tu página para la cafetería.",
    "Ya he enviado el correo a Juan.",
    "Tu página ya está publicada.",
    "Estou criando o site agora.",
    "Pronto! Criei o arquivo de notas.",
    "Já enviei o e-mail para Maria.",
  ])("recognizes %j", (text) => {
    expect(claimsAction(text)).toBe(true);
  });

  it.each([
    "Do you want me to create the website?",
    "¿Quieres que la publique en un sitio?",
    "I can't publish from here, but I can write the files. Want that?",
    "Hey! How's your Friday going?",
    "Posso criar o site se você quiser.",
  ])("leaves %j alone", (text) => {
    expect(claimsAction(text)).toBe(false);
  });
});

describe("the claim guard on the model's stream", () => {
  // Ten "do X" requests: the first answer only claims, the retry calls a tool.
  const requests: Array<[string, string]> = [
    ["make me a website for a coffee shop and publish it", "I'm building your website now."],
    ["hazme una página web para una cafetería y publícala", "Listo, creé tu página web."],
    ["create a file notes.md with a packing list", "I've created notes.md for you."],
    ["crea un archivo con mi lista de compras", "Estoy creando el archivo ahora."],
    ["send an email to Ana", "I've sent the email to Ana."],
    ["manda un correo a Pedro", "Ya he enviado el correo a Pedro."],
    ["search the web for today's weather", "I'm searching the web now."],
    ["faça um site para minha padaria", "Estou criando o site agora."],
    ["crie um arquivo de notas", "Pronto! Criei o arquivo de notas."],
    ["agenda una reunión mañana a las 10", "Listo, agendé tu reunión."],
  ];
  it.each(requests)("asks %j again and shows the tool call, not the claim", async (_ask, claim) => {
    let retries = 0;
    const out = guardActionClaims(sse({ role: "assistant" }, { content: claim }), async () => {
      retries++;
      return sse(call("write_file"));
    });
    const seen = await read(out);
    expect(retries).toBe(1);
    expect(seen.toolCalls).toBeGreaterThanOrEqual(1);
    expect(claimsAction(seen.content)).toBe(false);
  });

  it("passes a tool call and its text straight through", async () => {
    const out = guardActionClaims(sse({ content: "Let me check." }, call("web_search")), () => {
      throw new Error("no retry");
    });
    expect(await read(out)).toEqual({ content: "Let me check.", toolCalls: 1 });
  });

  it("passes an honest answer through after its first sentence", async () => {
    const out = guardActionClaims(
      sse(
        { content: "I can't publish " },
        { content: "from here. " },
        { content: "Want the files?" },
      ),
      () => {
        throw new Error("no retry");
      },
    );
    expect((await read(out)).content).toBe("I can't publish from here. Want the files?");
  });

  it("says so honestly when the retry fails", async () => {
    const out = guardActionClaims(sse({ content: "I've published the site." }), async () => {
      throw new Error("down");
    });
    const seen = await read(out);
    expect(claimsAction(seen.content)).toBe(false);
    expect(seen.content).toContain("couldn't");
  });
});

describe("where the guard applies", () => {
  const user = (content: string) => ({ role: "user", content });
  it("checks tasks and go-aheads, not plain chat or turns where a tool ran", () => {
    expect(guardsActionClaims([user("hazme una página web")])).toBe(true);
    expect(guardsActionClaims([user("ok do it")])).toBe(true);
    expect(guardsActionClaims([user("dale")])).toBe(true);
    expect(guardsActionClaims([user("hey")])).toBe(false);
    expect(guardsActionClaims([user("who painted the Mona Lisa?")])).toBe(false);
    expect(
      toolRanThisTurn([
        user("make a file"),
        { role: "assistant" },
        { role: "tool", content: "ok" },
      ]),
    ).toBe(true);
    expect(toolRanThisTurn([{ role: "tool" }, user("thanks")])).toBe(false);
  });

  it("puts the rule in every system prompt and the note on the retry", () => {
    const body = (text: string) =>
      JSON.stringify({
        messages: [
          { role: "system", content: "Platform.\n\nYou are Chief.\n\nManual." },
          user(text),
        ],
        tools: [{ type: "function", function: { name: "write_file" } }],
        reasoning_effort: "none",
      });
    for (const text of ["hey", "make me a website"]) {
      const sent = JSON.parse(quickChatBody(body(text))!.body);
      expect(sent.messages[0].content).toContain(HONESTY_RULE);
    }
    const retried = JSON.parse(withUseToolsNote(body("make me a website")));
    expect(retried.messages.at(-1).content).toContain(USE_TOOLS_NOTE);
  });
});
