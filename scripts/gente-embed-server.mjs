#!/usr/bin/env node
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Puts the server inside the app: unpacks the bundle from build-server-bundle.mjs into
// apps/desktop/build/server-dir/rakazo-server, adds Postgres 16 (zonky's embedded binaries,
// pinned by SHA-1 from Maven Central) and writes apps/desktop/build/server-bundle.json.
// The app runs the server straight from its resources: no download and no unpack on first run.
//   node scripts/gente-embed-server.mjs <bundle-dir>
// Windows arm64 uses the x64 Postgres (Windows 11 runs it under emulation); Macs get a
// universal build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "16.16.0";
const POSTGRES = {
  win32: { name: "windows-amd64", sha1: "7ee198f7df8f1a400e68de743060252fb4bfeea2" },
  "darwin-x64": { name: "darwin-amd64", sha1: "cde5c21297a05d688224fb75415e7c009a7322b0" },
  "darwin-arm64": { name: "darwin-arm64v8", sha1: "2756542744a422d5ca35440a056540adb87b6667" },
};

const [bundleDir] = process.argv.slice(2);
if (!bundleDir) throw new Error("Usage: gente-embed-server.mjs <bundle-dir>");
const pin = POSTGRES[process.platform] ?? POSTGRES[`${process.platform}-${process.arch}`];
if (!pin) throw new Error(`No embedded Postgres for ${process.platform}-${process.arch}`);
const pattern = new RegExp(`^rakazo-server-${process.platform}-${process.arch}-(.+)\\.tar\\.xz$`);
const source = fs.readdirSync(bundleDir).find((f) => pattern.test(f));
if (!source) throw new Error(`No rakazo-server-${process.platform}-${process.arch}-*.tar.xz in ${bundleDir}`);
const bundleVersion = source.match(pattern)[1];

const desktopBuild = path.resolve("apps/desktop/build");
const into = path.join(desktopBuild, "server-dir");
fs.rmSync(into, { recursive: true, force: true });
fs.mkdirSync(into, { recursive: true });
// Relative paths only: GNU tar on Windows reads "D:\\..." as a remote host.
const untar = (archive, cwd) =>
  execFileSync("tar", ["-xJf", path.relative(cwd, archive)], { cwd, stdio: "inherit" });
untar(path.resolve(bundleDir, source), into);
const server = path.join(into, "rakazo-server");

const url = `https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-${pin.name}/${VERSION}/embedded-postgres-binaries-${pin.name}-${VERSION}.jar`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Postgres download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha1 = createHash("sha1").update(bytes).digest("hex");
if (sha1 !== pin.sha1) throw new Error(`Postgres jar SHA-1 ${sha1} does not match the pin`);
const work = fs.mkdtempSync(path.join(path.resolve(bundleDir), "pg-"));
const jar = path.join(work, "postgres.jar");
fs.writeFileSync(jar, bytes);
// The jar is a zip: 7-Zip is on every GitHub Windows runner, unzip on every Mac.
if (process.platform === "win32") execFileSync("7z", ["x", "-y", `-o${work}`, jar], { stdio: "inherit" });
else execFileSync("unzip", ["-qo", jar, "-d", work], { stdio: "inherit" });
const txz = fs.readdirSync(work).find((f) => f.endsWith(".txz"));
if (!txz) throw new Error("The Postgres jar holds no .txz");
const postgresDir = path.join(server, "postgres");
fs.mkdirSync(postgresDir);
untar(path.join(work, txz), postgresDir);
fs.rmSync(work, { recursive: true, force: true });
const exe = process.platform === "win32" ? ".exe" : "";
for (const program of ["initdb", "postgres", "pg_ctl"]) {
  if (!fs.existsSync(path.join(postgresDir, "bin", `${program}${exe}`)))
    throw new Error(`Postgres ${program} is missing from the bundle`);
}

const descriptor = {
  version: `${process.platform}-${process.arch}-${bundleVersion}`,
  postgres: VERSION,
  inPlace: true,
};
fs.writeFileSync(path.join(desktopBuild, "server-bundle.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
console.log(JSON.stringify(descriptor));
