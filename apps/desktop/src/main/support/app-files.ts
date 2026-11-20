// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Finds parts of the bundled server that are missing: an entry file the manifest names, or a
// module a service failed to load ("Cannot find module …" in its log).
import path from "node:path";

const MODULE_NOT_FOUND =
  /Cannot find (?:module|package) ['"]([^'"]+)['"]|ERR_MODULE_NOT_FOUND[^'"]*['"]([^'"]+)['"]/;

export function findMissingAppFiles(input: {
  serverDir: string | null;
  manifest: { entrypoints?: Record<string, string> } | null;
  exists: (file: string) => boolean;
  serviceLogLines: readonly string[];
}): string[] {
  const missing = new Set<string>();
  if (input.serverDir && input.manifest?.entrypoints) {
    for (const [name, file] of Object.entries(input.manifest.entrypoints)) {
      if (!input.exists(path.resolve(input.serverDir, file))) missing.add(`${name}: ${file}`);
    }
  }
  for (const line of input.serviceLogLines) {
    const match = MODULE_NOT_FOUND.exec(line);
    const name = match?.[1] ?? match?.[2];
    // Only the package name: a full path would carry the person's folders.
    if (name)
      missing.add(
        `module ${path.isAbsolute(name) || name.startsWith(".") ? path.basename(name) : name}`,
      );
  }
  return [...missing];
}
