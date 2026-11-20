// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Windows: the installer writes the server out with pnpm's links as directory junctions and
// lists them in gente-links.json. A junction stores an absolute path; if its spelling differs
// from the folder the app runs from (for example "gente" versus "Gente"), Node loads a package
// twice and checks such as `pool instanceof pg.Pool` fail (Prisma then dialed localhost:5432).
// Before the server runs, every junction is pointed at exactly the app's own spelling.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

export const SERVER_LINKS_FILE = "gente-links.json";

/** Windows reports junction targets with a \\?\ prefix. */
function stripLongPrefix(value: string): string {
  const plain = value.startsWith("\\\\?\\") ? value.slice(4) : value;
  return plain.length > 3 ? plain.replace(/[\\/]+$/, "") : plain;
}

/** Returns how many links it created; 0 when there is no list or every link is in place. */
export function ensureServerLinks(serverDir: string, onMismatch?: (line: string) => void): number {
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
      const now = stripLongPrefix(readlinkSync(link));
      if (now === target) continue;
      if (created === 0) onMismatch?.(`${link}: ${now} -> ${target}`);
      // A junction is removed like an empty folder; its target is untouched.
      try {
        rmdirSync(link);
      } catch {
        unlinkSync(link);
      }
    } else if (current) {
      continue; // A real folder already: leave it.
    }
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, "junction");
    created++;
  }
  return created;
}
