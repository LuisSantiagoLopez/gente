#!/usr/bin/env node
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Turns the server bundle built on Windows (rakazo-server-win32-x64-<v>.tar.xz from
// build-server-bundle.mjs) into the zip the Windows app downloads: the same server plus its own
// Postgres 16 (zonky's embedded binaries, pinned by SHA-1 from Maven Central), so a Windows PC
// needs no Docker and no separate database install.
// Usage: node scripts/burrow-windows-bundle.mjs <bundle-dir> <download-base-url>
// Runs on a Windows runner (tar.exe reads .tar.xz and zip; 7z writes the zip).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const POSTGRES = {
  version: "16.16.0",
  url: "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/16.16.0/embedded-postgres-binaries-windows-amd64-16.16.0.jar",
  sha1: "7ee198f7df8f1a400e68de743060252fb4bfeea2",
};

const [bundleDir, base] = process.argv.slice(2);
if (!bundleDir || !base) throw new Error("Usage: burrow-windows-bundle.mjs <bundle-dir> <download-base-url>");
const source = fs.readdirSync(bundleDir).find((f) => /^rakazo-server-win32-.*\.tar\.xz$/.test(f));
if (!source) throw new Error(`No rakazo-server-win32-*.tar.xz in ${bundleDir}`);
const version = source.replace(/^rakazo-server-win32-[^-]+-/, "").replace(/\.tar\.xz$/, "");
const work = fs.mkdtempSync(path.join(bundleDir, "work-"));
// Relative paths only: GNU tar on Windows reads "D:\\..." as a remote host.
execFileSync("tar", ["-xJf", path.relative(work, path.join(bundleDir, source))], { cwd: work, stdio: "inherit" });
const server = path.join(work, "rakazo-server");

const jar = path.join(work, "postgres.jar");
const response = await fetch(POSTGRES.url);
if (!response.ok) throw new Error(`Postgres download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha1 = createHash("sha1").update(bytes).digest("hex");
if (sha1 !== POSTGRES.sha1) throw new Error(`Postgres jar SHA-1 ${sha1} does not match the pin`);
fs.writeFileSync(jar, bytes);
const jarDir = path.join(work, "jar");
fs.mkdirSync(jarDir);
// The jar is a zip; 7-Zip is on every GitHub Windows runner.
execFileSync("7z", ["x", "-y", `-o${jarDir}`, jar], { stdio: "inherit" });
const txz = fs.readdirSync(jarDir).find((f) => f.endsWith(".txz"));
if (!txz) throw new Error("The Postgres jar holds no .txz");
const postgresDir = path.join(server, "postgres");
fs.mkdirSync(postgresDir);
execFileSync("tar", ["-xJf", path.relative(postgresDir, path.join(jarDir, txz))], { cwd: postgresDir, stdio: "inherit" });
for (const program of ["initdb", "postgres", "pg_ctl"]) {
  if (!fs.existsSync(path.join(postgresDir, "bin", `${program}.exe`)))
    throw new Error(`Postgres ${program}.exe is missing from the bundle`);
}

const name = `burrow-server-win32-x64-${version}.zip`;
const zip = path.join(bundleDir, name);
fs.rmSync(zip, { force: true });
execFileSync("7z", ["a", "-tzip", "-mx=7", zip, "rakazo-server"], { cwd: work, stdio: "inherit" });
const archive = fs.readFileSync(zip);
const descriptor = {
  url: `${base.replace(/\/$/, "")}/${name}`,
  sha256: createHash("sha256").update(archive).digest("hex"),
  size: archive.length,
  version: `win-${version}`,
};
fs.writeFileSync(path.join(bundleDir, "server-bundle.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
fs.rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(descriptor));
