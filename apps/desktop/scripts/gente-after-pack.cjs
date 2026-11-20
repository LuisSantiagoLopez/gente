// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Puts the server inside the macOS and Windows app and proves it boots before the build can ship.
// electron-builder's resource copy breaks pnpm's linked node_modules (a 0.2.0 build failed with
// ERR_MODULE_NOT_FOUND for zod), so the folder is copied with `ditto`, which keeps the links.
// Then two checks fail the build:
//   1. every link in the copied server resolves inside the app;
//   2. the API, worker and migrate entry points load from inside the .app with the app's own
//      runtime, with no "module not found" error.
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MISSING = /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|ERR_PACKAGE_PATH_NOT_EXPORTED/;

function brokenLinks(root) {
  const broken = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
        if (!fs.existsSync(target) || !target.startsWith(root)) broken.push(full);
      } else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return broken;
}


/** Loads one entry for a few seconds. Startup errors about config are fine; missing modules are not. */
function bootOnce(exe, entry, cwd) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(exe, [entry], {
      cwd,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Windows programs need these; absent elsewhere.
        ...Object.fromEntries(
          ["SystemRoot", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]
            .filter((name) => process.env[name])
            .map((name) => [name, process.env[name]]),
        ),
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://gente-boot-check:x@127.0.0.1:1/none",
        // Never touch a running Gente: port 0 picks a free port if anything listens at all.
        PORT: "0",
        API_PORT: "0",
        WEB_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (d) => (out += d.toString());
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/** Copies a folder without its links and writes gente-links.json (link → target, server-relative). */
function copyWithoutLinks(source, target) {
  const links = [];
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (entry.isSymbolicLink()) {
        const real = path.resolve(path.dirname(a), fs.readlinkSync(a));
        if (!real.startsWith(source + path.sep) || !fs.statSync(real).isDirectory())
          throw new Error(`Server link ${a} does not point to a folder inside the server`);
        links.push([path.relative(source, a), path.relative(source, real)]);
      } else if (entry.isDirectory()) walk(a, b);
      else fs.copyFileSync(a, b);
    }
  };
  walk(source, target);
  fs.writeFileSync(path.join(target, "gente-links.json"), JSON.stringify(links));
  console.log(`  • gente server: ${links.length} links listed for the app to restore`);
}

function readLinks(server) {
  return JSON.parse(fs.readFileSync(path.join(server, "gente-links.json"), "utf8"));
}

function linkAll(server) {
  for (const [link, target] of readLinks(server)) {
    fs.mkdirSync(path.dirname(path.join(server, link)), { recursive: true });
    fs.symlinkSync(path.join(server, target), path.join(server, link), "junction");
  }
}

function unlinkAll(server) {
  for (const [link] of readLinks(server)) fs.rmSync(path.join(server, link), { force: true });
}

exports.default = async function afterPack(context) {
  const mac = context.electronPlatformName === "darwin";
  const windows = context.electronPlatformName === "win32";
  if (!mac && !windows) return;
  const source = path.resolve(__dirname, "../build/server-dir/rakazo-server");
  if (!fs.existsSync(source)) throw new Error(`Server folder missing at ${source}`);
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resources = mac
    ? path.join(context.appOutDir, appName, "Contents/Resources")
    : path.join(context.appOutDir, "resources");
  const server = path.join(resources, "rakazo-server");
  fs.rmSync(server, { recursive: true, force: true });
  // Windows installers cannot carry links: copy the server without them and list them in
  // gente-links.json; the app puts them back as junctions (server-links.ts).
  if (mac) execFileSync("ditto", [source, server]);
  else copyWithoutLinks(source, server);

  if (windows) linkAll(server);
  const broken = brokenLinks(server);
  if (broken.length > 0)
    throw new Error(`Server has ${broken.length} broken links, first: ${broken.slice(0, 5).join(", ")}`);

  const exe = mac
    ? path.join(context.appOutDir, appName, "Contents/MacOS", context.packager.appInfo.productFilename)
    : path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const manifest = JSON.parse(fs.readFileSync(path.join(server, "manifest.json"), "utf8"));
  for (const [name, rel] of Object.entries(manifest.entrypoints)) {
    const entry = path.join(server, rel);
    if (!fs.existsSync(entry)) throw new Error(`Server entry ${name} missing at ${rel}`);
    const out = await bootOnce(exe, entry, server);
    if (MISSING.test(out)) throw new Error(`${name} failed to load from inside the app:\n${out.slice(0, 2000)}`);
    console.log(`  • gente boot check: ${name} loads from inside the app`);
  }
  // The installer must not follow the junctions made for the check.
  if (windows) unlinkAll(server);
};

exports.brokenLinks = brokenLinks;
