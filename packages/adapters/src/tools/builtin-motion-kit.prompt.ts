// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// The motion kit the "Make a video with code" skill hands the model: one tested Python script
// that turns a short scenes.json (kicker, title, line per scene, a palette) into a 1280x720 MP4
// with a warm gradient, glow, drifting embers, eased text, cross-fades and a soft music pad.
// The text-only cloud model wrote its own renderers and could not see the result (black frames,
// a giant circle over the title); a known-good renderer makes the result good without sight.
// Tested 2026-11-23: 15 s renders in about 20 s on a Mac, 1 to 2 minutes on a 2-CPU computer.
// Who reads this: builtin-make-skills.prompt.ts.

export const MOTION_KIT_PY = String.raw`# Your AI motion kit: renders a short title video from scenes.json with Pillow + numpy + ffmpeg.
# python3 motion.py scenes.json out.mp4 [--seconds N]   (N renders only the first N seconds)
import json, math, subprocess, sys, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
limit = float(sys.argv[sys.argv.index("--seconds") + 1]) if "--seconds" in sys.argv else None
W, H = spec.get("size", [1280, 720])
FPS = 30
fonts = spec.get("fonts", {"display": "display.ttf", "body": "body.otf"})
hexrgb = lambda h: tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
pal = {k: hexrgb(v) for k, v in spec.get("palette", {
    "top": "#1a0f0a", "bottom": "#4a2512", "glow": "#e07a2c", "title": "#f6e7d2", "accent": "#e8a34c", "text": "#d9c3a5"}).items()}
scenes = spec["scenes"]
total = sum(s.get("seconds", 3) for s in scenes)
if limit: total = min(total, limit)
ease = lambda x: 1 - (1 - max(0.0, min(1.0, x))) ** 3

# Background: vertical gradient plus a soft glow, built once.
y = np.linspace(0, 1, H)[:, None, None]
bg = (np.array(pal["top"]) * (1 - y) + np.array(pal["bottom"]) * y) * np.ones((1, W, 1))
yy, xx = np.mgrid[0:H, 0:W]

def glow(cx, cy, r, strength):
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    return (np.exp(-d ** 2) * strength)[:, :, None] * np.array(pal["glow"])[None, None, :]

rng = random.Random(7)
embers = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(8, 30), rng.uniform(1.2, 3.2), rng.uniform(0, 6.28)) for _ in range(70)]
font_cache = {}
def font(kind, size):
    key = (kind, size)
    if key not in font_cache:
        f = ImageFont.truetype(fonts[kind], size)
        if kind == "display":
            try: f.set_variation_by_name("Bold")
            except Exception: pass
        font_cache[key] = f
    return font_cache[key]

def text_layer(scene, local, dur):
    """Title and lines for one scene at time local, as an RGBA layer."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    items = []
    if scene.get("kicker"): items.append(("body", int(H * 0.035), scene["kicker"].upper(), pal["accent"], 0.0, 6))
    if scene.get("title"): items.append(("display", int(H * scene.get("title_scale", 0.13)), scene["title"], pal["title"], 0.25, 0))
    if scene.get("line"): items.append(("body", int(H * 0.042), scene["line"], pal["text"], 0.6, 1))
    heights, widths = [], []
    for kind, size, txt, _, _, spacing in items:
        b = d.textbbox((0, 0), txt, font=font(kind, size))
        widths.append(b[2] - b[0] + spacing * max(0, len(txt) - 1)); heights.append(b[3] - b[1])
    gap = int(H * 0.04)
    block = sum(heights) + gap * (len(items) - 1)
    top = (H - block) / 2
    for (kind, size, txt, color, delay, spacing), w, h in zip(items, widths, heights):
        a = ease((local - delay) / 0.9) * ease((dur - local) / 0.6)
        x = (W - w) / 2
        yv = top + (1 - ease((local - delay) / 0.9)) * 24
        f = font(kind, size)
        b = d.textbbox((0, 0), txt, font=f)
        if spacing:
            cx = x
            for ch in txt:
                d.text((cx, yv - b[1]), ch, font=f, fill=color + (int(255 * a),))
                cx += d.textlength(ch, font=f) + spacing
        else:
            d.text((x, yv - b[1]), txt, font=f, fill=color + (int(255 * a),))
        top += h + gap
    if scene.get("rule"):
        a = ease((local - 0.8) / 0.8)
        half = int(W * 0.08 * a)
        d.line([(W / 2 - half, top + 6), (W / 2 + half, top + 6)], fill=pal["accent"] + (int(220 * a * ease((dur - local) / 0.6)),), width=2)
    shadow = layer.filter(ImageFilter.GaussianBlur(18))
    return shadow, layer

proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out + ".video.mp4"], stdin=subprocess.PIPE)
frames = int(total * FPS)
starts = np.cumsum([0] + [s.get("seconds", 3) for s in scenes])
cache = {}
for i in range(frames):
    t = i / FPS
    k = max(j for j in range(len(scenes)) if starts[j] <= t)
    s, local, dur = scenes[k], t - starts[k], scenes[k].get("seconds", 3)
    pulse = 0.55 + 0.1 * math.sin(t * 1.3)
    frame = bg + glow(W / 2, H * 0.62, W * 0.42, pulse * s.get("glow", 1.0))
    img = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img, "RGBA")
    for (ex, ey, sp, r, ph) in embers:
        py = (ey - t * sp) % H
        px = ex + 12 * math.sin(t * 0.7 + ph)
        a = int(140 * (0.5 + 0.5 * math.sin(t * 2 + ph)) * (py / H))
        d.ellipse([px - r, py - r, px + r, py + r], fill=pal["accent"] + (a,))
    key = (k, round(local * FPS))
    shadow, layer = text_layer(s, local, dur)
    img = Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGBA")
    img = Image.alpha_composite(img, layer).convert("RGB")
    fade = ease(t / 0.8) * ease((total - t) / 1.0)
    arr = (np.asarray(img).astype(np.float32) * (0.15 + 0.85 * fade)).astype(np.uint8)
    proc.stdin.write(arr.tobytes())
    if i % 60 == 0: print(f"frame {i}/{frames}", flush=True)
proc.stdin.close(); proc.wait()
# Soft warm pad: three quiet sine notes, faded in and out.
notes = spec.get("music_hz", [110, 164.8, 220])
src = []
for n in notes: src += ["-f", "lavfi", "-i", f"sine=frequency={n}:duration={total}"]
mix = "".join(f"[{j + 1}]" for j in range(len(notes))) + f"amix=inputs={len(notes)},volume=0.35,afade=t=in:d=2,afade=t=out:st={max(0, total - 2.5)}:d=2.5,lowpass=f=900[a]"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", out + ".video.mp4", *src, "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", out], check=True)
print("done", out)
`;
