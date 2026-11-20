// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Koffi's native module ships in a per-platform package that electron-builder can leave out of
// the app (the app then stops at launch with "Cannot find the native Koffi module"). Copy it to
// build/koffi/<platform>_<arch>/koffi.node; the app ships it as resources/koffi, where Koffi looks.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// pnpm keeps the platform package next to koffi's real folder.
const koffiDir = fs.realpathSync(path.join(here, "..", "node_modules", "koffi"));
const arch = process.env.GENTE_TARGET_ARCH || process.arch;
const triplet = `${process.platform}_${arch}`;
const pkg = path.join(koffiDir, "..", "@koromix", `koffi-${process.platform}-${arch}`);
const source = path.join(pkg, triplet, "koffi.node");
const target = path.join(here, "..", "build", "koffi", triplet, "koffi.node");
fs.rmSync(path.join(here, "..", "build", "koffi"), { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`koffi: ${source} -> ${target}`);
