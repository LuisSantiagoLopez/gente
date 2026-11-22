// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Writes the tiny bash helper that swaps the app after it quits. Steps:
//   wait for the app to quit -> move the old app to a backup -> ditto the new app in ->
//   check its version -> remove quarantine -> relaunch -> unmount the DMG.
// If the copy or the check fails, the backup goes back and the old app relaunches.
// The result ("installed" or "rolled-back") is written to a status file the app reads on launch.
// User data lives in ~/Library/Application Support, outside the bundle, so it is never touched.

export interface HelperScriptOptions {
  /** The app process to wait for. */
  pid: number;
  /** The installed bundle to replace, e.g. /Applications/Your AI.app. */
  target: string;
  /** The new bundle inside the mounted DMG. */
  source: string;
  /** Where the DMG is mounted, to unmount at the end. */
  mountPoint: string;
  newVersion: string;
  logFile: string;
  statusFile: string;
  /** Used when the helper runs as root, so the app relaunches as the person, not as root. */
  user: { uid: number; name: string };
  /** Seconds to wait for the app to quit before giving up (the old app keeps running). */
  quitTimeoutSeconds?: number;
  /** Test hook: the copy command. Defaults to /usr/bin/ditto. */
  copyCommand?: string;
  /** Test hook: the relaunch command. Defaults to /usr/bin/open -n. */
  openCommand?: string;
}

/** Quotes one value for bash, safe for any path (spaces, quotes, `$`). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function helperScript(options: HelperScriptOptions): string {
  const q = shellQuote;
  const timeoutTicks = (options.quitTimeoutSeconds ?? 180) * 10;
  return `#!/bin/bash
# Your AI update helper (generated). Replaces the app bundle after the app quits.
set -u
PID=${options.pid}
TARGET=${q(options.target)}
SOURCE=${q(options.source)}
MOUNT=${q(options.mountPoint)}
NEW_VERSION=${q(options.newVersion)}
LOG=${q(options.logFile)}
STATUS=${q(options.statusFile)}
RUN_UID=${options.user.uid}
RUN_USER=${q(options.user.name)}
COPY=${q(options.copyCommand ?? "/usr/bin/ditto")}
OPEN=${q(options.openCommand ?? "/usr/bin/open")}
BACKUP="$TARGET.update-backup"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) update-helper: $*" >> "$LOG"; }
status() { printf '%s %s\\n' "$1" "$NEW_VERSION" > "$STATUS"; }
unmount() { /usr/bin/hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || /usr/bin/hdiutil detach "$MOUNT" -force -quiet >/dev/null 2>&1 || true; }
relaunch() {
  if [ "$(id -u)" = 0 ]; then
    /bin/launchctl asuser "$RUN_UID" /usr/bin/sudo -u "$RUN_USER" "$OPEN" -n "$TARGET" >> "$LOG" 2>&1 || log "relaunch failed"
  else
    "$OPEN" -n "$TARGET" >> "$LOG" 2>&1 || log "relaunch failed"
  fi
}
installed_version() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$1/Contents/Info.plist" 2>/dev/null
}

log "waiting for the app (pid $PID) to quit"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge ${timeoutTicks} ]; then
    log "the app did not quit; nothing changed"
    status failed
    unmount
    exit 1
  fi
  sleep 0.1
done

rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then
  log "could not move the old app aside; nothing changed"
  status failed
  relaunch
  unmount
  exit 1
fi

if "$COPY" "$SOURCE" "$TARGET" >> "$LOG" 2>&1 && [ "$(installed_version "$TARGET")" = "$NEW_VERSION" ]; then
  if [ "$(id -u)" = 0 ]; then
    OWNER="$(stat -f %u:%g "$BACKUP")"
    chown -R "$OWNER" "$TARGET" >> "$LOG" 2>&1 || true
  fi
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" >> "$LOG" 2>&1 || true
  rm -rf "$BACKUP"
  status installed
  log "installed $NEW_VERSION"
else
  log "copy failed; putting the old app back"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  status rolled-back
fi
relaunch
unmount
exit 0
`;
}
