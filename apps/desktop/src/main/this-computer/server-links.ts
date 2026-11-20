// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Windows installers cannot carry pnpm's linked node_modules, and copying the linked folders
// breaks how Node finds each package's own dependencies. So the Windows build ships the server
// without its links plus gente-links.json (link → target, both inside the server), and the app
// puts the links back as directory junctions (no admin rights needed) before the server runs.
// Already-correct links are left alone, so this is a quick check after the first start.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

export const SERVER_LINKS_FILE = "gente-links.json";

/** Returns how many links it created; 0 when there is no list or every link is in place. */
export function ensureServerLinks(serverDir: string): number {
  const list = path.join(serverDir, SERVER_LINKS_FILE);
  if (!existsSync(list)) return 0;
  const links = JSON.parse(readFileSync(list, "utf8")) as [string, string][];
  const root = path.resolve(serverDir);
  let created = 0;
  for (const [linkRel, targetRel] of links) {
    const link = path.resolve(root, linkRel);
    const target = path.resolve(root, targetRel);
    if (!link.startsWith(root + path.sep) || !target.startsWith(root + path.sep))
      throw new Error(`Server link outside the server: ${linkRel} -> ${targetRel}`);
    const current = lstatSync(link, { throwIfNoEntry: false });
    if (current?.isSymbolicLink()) {
      if (path.resolve(path.dirname(link), readlinkSync(link)) === target) continue;
      rmSync(link, { force: true });
    } else if (current) {
      continue; // A real folder already: leave it.
    }
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, "junction");
    created++;
  }
  return created;
}
