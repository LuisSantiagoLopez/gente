#!/usr/bin/env python3
"""Tiny emulator driver: tap by visible text or content description, take screenshots."""
import re, subprocess, sys, time, os
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")

def sh(*a, **k): return subprocess.run([ADB, *a], capture_output=True, text=k.get("text", True)).stdout

def dump():
    for _ in range(5):
        sh("shell", "uiautomator", "dump", "/sdcard/ui.xml")
        x = sh("shell", "cat", "/sdcard/ui.xml")
        if "<hierarchy" in x: return x
        time.sleep(0.5)
    return ""

def find(label, exact=False):
    x = dump()
    for m in re.finditer(r'<node [^>]*>', x):
        n = m.group(0)
        import html as _h
        tm = re.search(r'\btext="([^"]*)"', n); dm = re.search(r'content-desc="([^"]*)"', n)
        t = _h.unescape(tm.group(1)) if tm else ""; d = _h.unescape(dm.group(1)) if dm else ""
        hit = (label == t or label == d) if exact else (label in t or label in d)
        if hit:
            b = list(map(int, re.findall(r'\d+', re.search(r'bounds="([^"]*)"', n).group(1))))
            return ((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)
    return None

def tap(label, exact=False, wait=6.0):
    end = time.time() + wait
    while time.time() < end:
        p = find(label, exact)
        if p:
            sh("shell", "input", "tap", str(p[0]), str(p[1])); time.sleep(0.9); return True
        time.sleep(0.5)
    print(f"NOT FOUND: {label}", file=sys.stderr); return False

def shot(path):
    time.sleep(0.8)
    data = subprocess.run([ADB, "exec-out", "screencap", "-p"], capture_output=True).stdout
    open(path, "wb").write(data); print("saved", path, len(data))

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "tap": sys.exit(0 if tap(sys.argv[2], len(sys.argv) > 3 and sys.argv[3] == "exact") else 1)
    if cmd == "shot": shot(sys.argv[2])
    if cmd == "find": print(find(sys.argv[2]))
    if cmd == "home":  # press Back until the home screen's settings button shows
        for _ in range(5):
            if find(sys.argv[2], True): break
            sh("shell", "input", "keyevent", "KEYCODE_BACK"); time.sleep(1.0)
