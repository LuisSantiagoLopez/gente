#!/bin/bash
# Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
# New file in Gente (a fork of Rakazo by Elie Steinbock).
#
# Checks a Mac DMG the way a person downloads it: copy the app out, mark it quarantined like a
# browser download, then ask codesign and Gatekeeper about it. Fails when the signature is broken,
# which is what makes macOS say "Your AI is damaged and should be moved to the Trash".
# An unsigned (ad-hoc) build is expected to be "rejected" by Gatekeeper; that gives the normal
# "unidentified developer" prompt, so it does not fail this check.
# Usage: gente-check-mac-signature.sh <file.dmg>
set -euo pipefail
dmg="$1"
work="$(mktemp -d)"
mnt="$work/mnt"
mkdir -p "$mnt"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null
trap 'hdiutil detach "$mnt" -quiet || true; rm -rf "$work"' EXIT
app="$(ls -d "$mnt"/*.app | head -1)"
copy="$work/$(basename "$app")"
ditto "$app" "$copy"
xattr -w com.apple.quarantine "0081;$(printf '%x' "$(date +%s)");Safari;" "$copy"
echo "== codesign -dv"
codesign -dv "$copy" 2>&1 | grep -E "Identifier|Format|Signature|TeamIdentifier|Sealed" || true
echo "== codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=2 "$copy"
echo "== spctl -a -vv (ad-hoc builds are expected to be rejected, not damaged)"
out="$(spctl -a -vv "$copy" 2>&1 || true)"
echo "$out"
if echo "$out" | grep -qiE "sealed resource|invalid signature|damaged|code object is not signed"; then
  echo "Gatekeeper sees a broken signature; a download would say the app is damaged." >&2
  exit 1
fi
echo "signature ok"
