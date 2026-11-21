#!/usr/bin/env node
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Release gate: every address the app may download from must answer before a build ships.
// Our own server ships inside the app, so only third-party runtimes and the models are checked.
// Usage: node scripts/gente-check-downloads.mjs   (exit 1 lists every address that failed)
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const urls = new Set();

// Ollama installers.
urls.add("https://ollama.com/download/Ollama-darwin.zip");
urls.add("https://ollama.com/download/OllamaSetup.exe");
// Apple's container runtime, pinned in mac-runtime.ts.
const mac = read("apps/desktop/src/main/this-computer/mac-runtime.ts");
const version = mac.match(/CONTAINER_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (version) urls.add(`https://github.com/apple/container/releases/download/${version}/container-${version}-installer-signed.pkg`);
// Every model file in the ladder (Hugging Face resolves each tag to one GGUF file).
const brain = read("apps/desktop/src/main/burrow/brain.ts");
for (const [, repo, quant] of brain.matchAll(/tag: "hf\.co\/([^:"]+):([^"]+)"/g)) {
  const tree = await (await fetch(`https://huggingface.co/api/models/${repo}/tree/main`)).json();
  const file = tree.find((f) => f.path.endsWith(`${quant}.gguf`) && !f.path.startsWith("mmproj"));
  urls.add(file ? `https://huggingface.co/${repo}/resolve/main/${file.path}` : `missing:${repo}:${quant}`);
}
// The Windows build's Postgres (fetched at build time, not by the app; checked so builds don't break).
const win = read("scripts/burrow-windows-bundle.mjs").match(/url: "([^"]+)"/)?.[1];
if (win) urls.add(win);

const failed = [];
for (const url of urls) {
  if (url.startsWith("missing:")) {
    failed.push(`${url} (no such file)`);
    continue;
  }
  let status = 0;
  for (let attempt = 0; attempt < 3 && status !== 200; attempt++) {
    status = await fetch(url, { method: "HEAD", redirect: "follow" }).then((r) => r.status).catch(() => 0);
  }
  console.log(status === 200 ? "ok  " : "FAIL", status, url);
  if (status !== 200) failed.push(`${status} ${url}`);
}
if (failed.length) {
  console.error(`\n${failed.length} download address(es) failed:\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`\nAll ${urls.size} download addresses answer.`);
