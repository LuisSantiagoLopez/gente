// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente: a reply never says it is doing, or did, something no tool did. A local model sometimes
// answers "I'm creating your website now…" without calling a tool. On a turn where no tool ran,
// the start of the reply is held back until it is clearly not such a claim; a claim is never
// shown, and the request is asked once more with a note to use the tools.

/** Added to the system prompt of every local request. */
export const HONESTY_RULE =
  "Never say you are doing or did something unless a tool call in this turn did it. If you can't, say so and offer the next step.";

/** Added to the system prompt of a local request that offers ask_user: questions go in cards. */
export const ASK_IN_CARDS_RULE =
  "Ask the person questions only with the ask_user tool, never in your reply text. Do not add an 'Other' option: the card already lets them type their own answer. When you finish, end with what you did, not with a question.";

/**
 * Added when a local request can write files. The model server sends a tool call only once it
 * is complete, so one huge file means minutes of silence; small files arrive one by one.
 */
export const SMALL_FILES_RULE =
  "When you build a page or app, start writing files right away with write_file, no plan first. Keep each file short (under about 120 lines): put the HTML, the CSS and the script in separate files and write them one call at a time.";

/** Adds the small-files rule to a request's system prompt, once, when it offers write_file. */
export function withSmallFilesRule(messages: Message[], tools: unknown): Message[] {
  const first = messages[0];
  if (first?.role !== "system" || typeof first.content !== "string") return messages;
  const writes =
    Array.isArray(tools) &&
    tools.some(
      (tool) => (tool as { function?: { name?: string } })?.function?.name === "write_file",
    );
  if (!writes || first.content.includes(SMALL_FILES_RULE)) return messages;
  return [{ ...first, content: `${first.content}\n\n${SMALL_FILES_RULE}` }, ...messages.slice(1)];
}

/** Adds the card rule to a request's system prompt, once, when the request offers ask_user. */
export function withAskInCardsRule(messages: Message[], tools: unknown): Message[] {
  const first = messages[0];
  if (first?.role !== "system" || typeof first.content !== "string") return messages;
  const offersAsk =
    Array.isArray(tools) &&
    tools.some((tool) => (tool as { function?: { name?: string } })?.function?.name === "ask_user");
  if (!offersAsk || first.content.includes(ASK_IN_CARDS_RULE)) return messages;
  return [{ ...first, content: `${first.content}\n\n${ASK_IN_CARDS_RULE}` }, ...messages.slice(1)];
}

/** Added to the person's message when the first answer claimed an action without a tool. */
export const USE_TOOLS_NOTE = "<tool_note>Use your tools to do this now.</tool_note>";

/** Characters of reply text held back before it is judged, unless a sentence ends first. */
export const CLAIM_WINDOW_CHARS = 160;

// First person, in progress or done: "I'm creating", "I've sent", "Listo, creé", "Estoy
// buscando", "Já criei", "Estou enviando", and promises to act now ("Let me build…", "I'll
// create…", "Voy a crear…"). Questions and offers ("Do you want me to create…",
// "¿Quieres que lo cree?") do not match.
const CLAIMS = [
  // English
  /\b(i'?m|i am)\s+(now\s+)?(creating|making|building|writing|sending|searching|looking|publishing|deploying|setting up|saving|scheduling|generating|designing|booking|ordering|opening|running|installing|uploading|downloading)\b/i,
  /\b(i'?ve|i have|i)\s+(just\s+)?(created|made|built|written|wrote|sent|published|deployed|set up|saved|scheduled|generated|designed|booked|ordered|opened|installed|uploaded|downloaded|searched)\b/i,
  /\b(done|all set)[!.,:]\s+(i|your|the)\b/i,
  // A promise to act now, with no tool call behind it: "Let me just build…", "I'll create…".
  /\b(let me|i'?ll|i will)\s+(now\s+|just\s+|go ahead and\s+)?(create|make|build|write|send|search|look up|publish|deploy|set up|save|schedule|generate|design|book|order|open|run|install|upload|download|code|put together|whip up)\b/i,
  /\b(your|the)\s+(website|site|page|file|email|document|reminder|event|image)\s+(is|has been)\s+(now\s+)?(ready|live|published|created|sent|saved|up)\b/i,
  // Spanish
  /\b(d[eé]jame|voy a|ahora)\s+(crear|hacer|construir|escribir|enviar|mandar|buscar|publicar|guardar|agendar|generar|diseñar|abrir|instalar|armar|programar)\b/i,
  /\b(estoy|ya estoy)\s+(creando|haciendo|construyendo|escribiendo|enviando|mandando|buscando|publicando|guardando|agendando|generando|diseñando|abriendo|instalando|subiendo|descargando|preparando)\b/i,
  /(^|[\s¡!.,])(listo|hecho|ya)[!.,:]?\s+(he\s+|ya\s+)?(cre[eé]|hice|constru[ií]|escrib[ií]|envi[eé]|mand[eé]|publiqu[eé]|guard[eé]|agend[eé]|gener[eé]|dise[nñ][eé]|abr[ií]|instal[eé]|sub[ií]|descargu[eé])\b/i,
  /\b(he|ya)\s+(creado|hecho|construido|escrito|enviado|mandado|publicado|guardado|agendado|generado|diseñado|abierto|instalado|subido|descargado)\b/i,
  /\b(cre[eé]|publiqu[eé]|envi[eé]|mand[eé]|guard[eé])\s+(tu|el|la|los|las|un|una)\b/i,
  /\b(tu|el|la)\s+(p[aá]gina|sitio|web|archivo|correo|documento|recordatorio|evento|imagen)\s+(ya\s+)?(est[aá]|qued[oó])\s+(lista?|publicada?|creada?|enviada?|guardada?|en l[ií]nea)\b/i,
  // Portuguese
  /\b(deixa eu|vou)\s+(criar|fazer|construir|escrever|enviar|mandar|pesquisar|publicar|salvar|agendar|gerar|abrir|instalar|montar)\b/i,
  /\b(estou|já estou)\s+(criando|fazendo|construindo|escrevendo|enviando|mandando|pesquisando|procurando|publicando|salvando|agendando|gerando|abrindo|instalando)\b/i,
  /\b(já|pronto)[!.,:]?\s+(criei|fiz|construí|escrevi|enviei|mandei|publiquei|salvei|agendei|gerei|abri|instalei)\b/i,
  /\b(eu\s+)?(criei|construí|enviei|publiquei|salvei|agendei)\s+(o|a|os|as|um|uma|seu|sua)\b/i,
];

/** `\b` that also treats accented letters ("creé", "já") as letters. */
const LETTER_BOUNDARY =
  "(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))";
const UNICODE_CLAIMS = CLAIMS.map(
  (pattern) => new RegExp(pattern.source.replaceAll("\\b", LETTER_BOUNDARY), "iu"),
);

/** Whether reply text says an action is happening or happened. */
export function claimsAction(text: string): boolean {
  const flat = text.replace(/\s+/g, " ");
  return UNICODE_CLAIMS.some((pattern) => pattern.test(flat));
}

type Message = { role?: string; content?: unknown; tool_calls?: unknown };

/** Whether a tool already ran in this turn (a tool result after the person's newest message). */
export function toolRanThisTurn(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i]?.role;
    if (role === "tool") return true;
    if (role === "user") return false;
  }
  return false;
}

/** The same request with the use-your-tools note on the person's newest message. */
export function withUseToolsNote(body: string): string {
  let parsed: { messages?: Message[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return body;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const content = message.content;
    messages[i] =
      typeof content === "string"
        ? { ...message, content: `${content}\n\n${USE_TOOLS_NOTE}` }
        : Array.isArray(content)
          ? { ...message, content: [...content, { type: "text", text: USE_TOOLS_NOTE }] }
          : message;
    break;
  }
  return JSON.stringify(parsed);
}

/** Adds the honesty rule to a request's system prompt, once. */
export function withHonestyRule(messages: Message[]): Message[] {
  const first = messages[0];
  if (first?.role !== "system" || typeof first.content !== "string") return messages;
  if (first.content.includes(HONESTY_RULE)) return messages;
  return [{ ...first, content: `${first.content}\n\n${HONESTY_RULE}` }, ...messages.slice(1)];
}

const encoder = new TextEncoder();

/**
 * Wraps a streamed chat-completions reply. Reply text is held back until a sentence ends or
 * CLAIM_WINDOW_CHARS arrive; then, unless it claims an action, it and everything after it pass
 * through unchanged. A tool call passes everything through at once. A claim with no tool call
 * drops this reply and streams `retry()` instead, once.
 */
export function guardActionClaims(response: Response, retry: () => Promise<Response>): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body || !type.includes("text/event-stream")) return response;
  const upstream = response.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder();
      const reader = upstream.getReader();
      let buffer = "";
      let held: string[] = [];
      let heldText = "";
      let passing = false;
      const release = () => {
        for (const line of held) controller.enqueue(encoder.encode(`${line}\n\n`));
        held = [];
        passing = true;
      };
      const swapToRetry = async () => {
        await reader.cancel().catch(() => undefined);
        const again = await retry().catch(() => null);
        if (!again?.ok || !again.body) {
          // Nothing better to show: an honest line instead of the claim.
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "I couldn't do that this time. Want me to try again?" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
            ),
          );
          return;
        }
        const retried = again.body.getReader();
        for (;;) {
          const { done, value } = await retried.read();
          if (done) break;
          controller.enqueue(value);
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (passing) {
            controller.enqueue(value);
            continue;
          }
          buffer += decoder.decode(value, { stream: true });
          let end = buffer.indexOf("\n\n");
          while (end >= 0 && !passing) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf("\n\n");
            if (!line) continue;
            if (!line.startsWith("data:")) {
              held.push(line);
              continue;
            }
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              if (claimsAction(heldText)) {
                await swapToRetry();
                controller.close();
                return;
              }
              held.push(line);
              release();
              continue;
            }
            let delta: { content?: unknown; tool_calls?: unknown } | undefined;
            try {
              delta = JSON.parse(data)?.choices?.[0]?.delta;
            } catch {
              delta = undefined;
            }
            held.push(line);
            if (delta?.tool_calls) {
              release();
              continue;
            }
            if (typeof delta?.content === "string") {
              heldText += delta.content;
              // The whole window is judged, not just the first sentence: "Sorry about that!
              // Let me build it now." claims in its second.
              const decided = heldText.length >= CLAIM_WINDOW_CHARS;
              if (decided) {
                if (claimsAction(heldText)) {
                  await swapToRetry();
                  controller.close();
                  return;
                }
                release();
              }
            } else if (!heldText) {
              // Thinking and role lines before any reply text show live.
              const line = held.pop()!;
              controller.enqueue(encoder.encode(`${line}\n\n`));
            }
          }
          if (passing && buffer) {
            controller.enqueue(encoder.encode(buffer));
            buffer = "";
          }
        }
        if (!passing) {
          if (claimsAction(heldText)) await swapToRetry();
          else {
            release();
            if (buffer) controller.enqueue(encoder.encode(buffer));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
