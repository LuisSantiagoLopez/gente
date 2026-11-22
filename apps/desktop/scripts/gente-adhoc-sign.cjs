// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Ad-hoc signs an unsigned Mac build as the last change to the .app, before the DMG is made.
// Why: Electron ships ad-hoc signed, but afterPack then adds the server to Contents/Resources,
// which breaks the bundle's sealed resources. A downloaded (quarantined) copy with a broken seal
// makes macOS say "Your AI is damaged". A fresh ad-hoc signature over the final bundle gives the
// normal "unidentified developer" prompt with "Open Anyway" instead.
// Skipped when a real Developer ID signs the app (electron-builder signs after afterPack).
const { execFileSync } = require("node:child_process");

/** True when electron-builder will not sign this Mac build itself. */
function isUnsignedBuild(context, env = process.env) {
  const identity = context.packager.platformSpecificBuildOptions?.identity;
  return identity === null || identity === "null" || env.CSC_IDENTITY_AUTO_DISCOVERY === "false";
}

/** Signs the whole bundle ad-hoc, then fails the build unless a strict deep verify passes. */
function adHocSign(appPath, run = execFileSync) {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "inherit" });
}

module.exports = { isUnsignedBuild, adHocSign };
