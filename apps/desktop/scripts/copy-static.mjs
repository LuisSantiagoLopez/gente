import { copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits the TypeScript sources; the preload bridges and the setup
// window's static assets have to be copied into dist alongside them.
const STATIC_FILES = [
  "preload/preload.cjs",
  "preload/setup-preload.cjs",
  "setup-renderer/setup.html",
  "setup-renderer/setup.css",
  "setup-renderer/setup.js",
  "preload/telegram-preload.cjs",
  "telegram-renderer/telegram.html",
  "telegram-renderer/telegram.css",
  "telegram-renderer/telegram.js",
  "preload/support-preload.cjs",
  "support-renderer/support.html",
  "support-renderer/support.css",
  "support-renderer/support.js",
  "preload/computer-pill-preload.cjs",
  "computer-pill-renderer/computer-pill.html",
  "computer-pill-renderer/computer-pill.css",
  "computer-pill-renderer/computer-pill.js",
  "preload/meeting-preload.cjs",
  "meeting-renderer/meeting.html",
  "meeting-renderer/meeting.js",
];
// Gente's help articles, read by the support window and its local search.
const HELP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/gente/help",
);
const TOKENS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui-tokens/src/tokens.css",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await mkdir(dist, { recursive: true });
await Promise.all([
  ...STATIC_FILES.map((file) =>
    copyFile(path.join(root, "src", file), path.join(dist, path.basename(file))),
  ),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
  cp(HELP_DIR, path.join(dist, "help"), { recursive: true }),
]);
