// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Stops a release before it builds when a signing secret is missing, and names each one.
//   node scripts/gente-check-signing.mjs mac|windows
const NEEDED = {
  mac: {
    MAC_CSC_LINK: 'base64 of the "Developer ID Application" .p12 (Apple Developer account)',
    MAC_CSC_KEY_PASSWORD: "password of that .p12",
    APPLE_API_KEY: "base64 of the App Store Connect API key (.p8) used to notarize",
    APPLE_API_KEY_ID: "that key's ID",
    APPLE_API_ISSUER: "the issuer ID shown above the keys in App Store Connect",
  },
  windows: {
    WIN_CSC_LINK: "base64 of the Windows code-signing certificate (.pfx)",
    WIN_CSC_KEY_PASSWORD: "password of that .pfx",
  },
};

const platform = process.argv[2];
const needed = NEEDED[platform];
if (!needed) {
  console.error("Usage: node scripts/gente-check-signing.mjs mac|windows");
  process.exit(2);
}
const missing = Object.entries(needed).filter(([name]) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing ${platform} signing secrets:`);
  for (const [name, what] of missing) console.error(`  - ${name}: ${what}`);
  process.exit(1);
}
console.log(`All ${platform} signing secrets are present.`);
