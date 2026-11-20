// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A small stand-in for Ollama, for testing Gente without a 17 GB model.
// Speaks the parts of the Ollama API and the OpenAI-compatible API that Gente uses.
//   node apps/desktop/scripts/ollama-stub.mjs [port]
// Env: STUB_FAIL_LOAD=tag1,tag2   models whose load fails with Ollama's out-of-memory error
//      STUB_INSTALLED=tag1,tag2   models already present at start
import http from "node:http";

export function createOllamaStub({ failLoad = [], installed = [] } = {}) {
  // "alias=tag" starts with an alias already made from those weights.
  const models = new Map(
    installed.map((name) => {
      const [alias, from] = name.split("=");
      return from ? [`${alias}:latest`, { from }] : [name, { from: name }];
    }),
  );
  const calls = [];
  const resolve = (name) => {
    const entry = models.get(name) ?? models.get(`${name}:latest`);
    return entry?.from ?? name;
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};
    calls.push({ path: req.url, body: json });
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    switch (req.url) {
      case "/api/version":
        return send(200, { version: "stub" });
      case "/api/tags":
        return send(200, { models: [...models.keys()].map((name) => ({ name })) });
      case "/api/pull": {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const total = 1000;
        for (const completed of [0, 250, 500, 1000]) {
          res.write(
            `${JSON.stringify({ status: "pulling", digest: "sha256:stub", total, completed })}\n`,
          );
        }
        models.set(json.model, { from: json.model });
        res.end(`${JSON.stringify({ status: "success" })}\n`);
        return;
      }
      case "/api/create":
        models.set(`${json.model}:latest`, { from: json.from, parameters: json.parameters });
        return send(200, { status: "success" });
      case "/api/generate":
        if (failLoad.includes(resolve(json.model)))
          return send(500, {
            error: "model requires more system memory (20.1 GiB) than is available (15.2 GiB)",
          });
        return send(200, { model: json.model, response: "", done: true });
      case "/api/show": {
        // The quantization is the tag's suffix (…GGUF:Q4_K_M), as Ollama reports it in details.
        const quant = /:([A-Z0-9_]+)$/.exec(resolve(json.model))?.[1];
        return send(200, {
          capabilities: ["completion", "tools"],
          ...(quant ? { details: { quantization_level: quant } } : {}),
        });
      }
      case "/v1/models":
        return send(200, {
          object: "list",
          data: [...models.keys()].map((id) => ({
            id: id.replace(/:latest$/, ""),
            object: "model",
          })),
        });
      case "/v1/chat/completions": {
        const last = json.messages?.at(-1);
        const text = `Stub reply from ${json.model}. You said: ${typeof last?.content === "string" ? last.content : "(parts)"}`;
        if (json.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          const chunk = (delta, finish = null) =>
            `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", model: json.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
          res.write(chunk({ role: "assistant", content: "" }));
          for (const word of text.split(" ")) res.write(chunk({ content: `${word} ` }));
          res.write(chunk({}, "stop"));
          res.write(
            `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", model: json.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`,
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        return send(200, {
          id: "stub",
          object: "chat.completion",
          model: json.model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }
      default:
        return send(404, { error: `stub has no ${req.url}` });
    }
  });
  return { server, models, calls };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 11500);
  const list = (name) => (process.env[name] ?? "").split(",").filter(Boolean);
  const { server } = createOllamaStub({
    failLoad: list("STUB_FAIL_LOAD"),
    installed: list("STUB_INSTALLED"),
  });
  server.listen(port, "127.0.0.1", () => console.log(`ollama stub on http://127.0.0.1:${port}`));
}
