// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Test-only helpers: a tiny fake "Your AI.app" (an Info.plist plus an executable that writes
// "launched <version>" to a marker file) and a latest-mac.yml for given files.
// `native: true` compiles a real Mach-O with clang, because LaunchServices (`open`) refuses a
// shell-script executable (error -10669); the helper tests that skip `open` use the script.
// Uses a test bundle id so LaunchServices never confuses it with the real app.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const TEST_BUNDLE_ID = "com.gente.updatetest";

export const hasClang = () => spawnSync("/usr/bin/clang", ["--version"]).status === 0;

export async function makeFakeApp(folder: string, version: string, marker: string, native = false) {
  const bundle = path.join(folder, "Your AI.app");
  await mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  await writeFile(
    path.join(bundle, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${TEST_BUNDLE_ID}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Your AI</string>
<key>CFBundleName</key><string>Your AI</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
`,
  );
  const exe = path.join(bundle, "Contents", "MacOS", "Your AI");
  if (native) {
    const source = `${exe}.c`;
    await writeFile(
      source,
      `#include <stdio.h>\nint main(void){FILE*f=fopen(${JSON.stringify(marker)},"a");if(!f)return 1;fputs("launched ${version}\\n",f);fclose(f);return 0;}\n`,
    );
    const built = spawnSync("/usr/bin/clang", ["-o", exe, source]);
    await rm(source);
    if (built.status !== 0) throw new Error(`clang failed: ${built.stderr}`);
    return bundle;
  }
  await writeFile(exe, `#!/bin/bash\necho "launched ${version}" >> '${marker}'\n`);
  await chmod(exe, 0o755);
  return bundle;
}

export async function sha512Base64(file: string) {
  return createHash("sha512")
    .update(await readFile(file))
    .digest("base64");
}

export function feedYaml(version: string, files: { url: string; sha512: string; size: number }[]) {
  const lines = [`version: ${version}`, "files:"];
  for (const file of files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
  }
  return `${lines.join("\n")}\n`;
}
