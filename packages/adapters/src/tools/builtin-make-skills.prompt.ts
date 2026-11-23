// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Built-in recipes for the three things people most often ask a bot to make in one chat: a small
// working app, a published website, and a short video made with code. They were written from
// test chats where the model knew how to write files but not how to put a site online (no
// account), what the cloud computer lacks (Node, Pillow) or how to turn an animation into an MP4.
// Checked on the cloud computer on 2026-11-22: ffmpeg and python3 are there; node and Pillow are
// not; `vercel deploy --temporary` works without an account. Who reads this: builtin-skills.

export const MAKE_SKILLS: Array<{ name: string; description: string; body: string }> = [
  {
    name: "Build a web app",
    description: "Make a small working app (tracker, to-do, calculator) and test it",
    body: `Use this when someone asks for an app, tool or tracker they can use.

1. Plan in one line: what screens and actions the app needs. Do not ask questions; choose sensible defaults.
2. Make one folder in your home, e.g. ~/apps/<name>/, with index.html, styles.css and app.js (plain HTML, CSS and JavaScript, no build step). Keep data in localStorage so it survives a reload. Format money and dates for people (2 decimals, readable dates). Validate input and show a clear message instead of failing.
3. Make it look finished: a real color palette, spacing, readable type, hover and focus states, an empty state, and a layout that works at 390 px wide.
4. Test it for real before you say it works. Serve it with \`cd ~/apps/<name> && python3 -m http.server 8000 >/dev/null 2>&1 &\`, open http://localhost:8000 with browser_navigate, and use it: add items, check totals, delete, reload the page and confirm the data is still there. Fix anything that fails and test again.
5. Give it to the user: attach_file each file (index.html with a name and description), and say what you tested and what you saw. To share it online, follow the "Publish a website" skill.
Never say a feature works unless you used it in the browser in this chat.`,
  },
  {
    name: "Publish a website",
    description: "Make a beautiful website and put it online with a live link",
    body: `Use this when someone asks for a website or landing page, or to publish one.

Design: pick a clear subject, audience and one feeling. Write real copy (no lorem ipsum). Choose a distinctive palette and a Google Font pair, a strong hero with one call to action, 3–5 sections, and generous spacing. Avoid template looks: no stock gradient-on-white hero with three identical cards. Use CSS only for art (gradients, shapes, SVG) instead of images you cannot license. Make it responsive (check 390 px and 1280 px).

Build: one folder, e.g. ~/sites/<name>/, with index.html and styles.css. Preview it with browser_navigate (python3 -m http.server as for apps) and look at it before you publish.

Publish (no account needed):
1. Node is not installed on the cloud computer. Install it once: \`which npx || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null && sudo apt-get install -y nodejs >/dev/null)\`
2. \`cd ~/sites/<name> && npx -y vercel@latest deploy --temporary --yes 2>&1 | tail -15\`
3. The output has the live URL (https://….tmp.now) and a claim link. Open the live URL with browser_navigate to check it loads. Then give the user both: the live link, and the claim link with this note: "It stays live for 60 minutes; open the claim link and sign in to Vercel (free) to keep it." Running the same command again in the same folder updates the same site.
Never say a site is published unless the command printed its URL in this chat.`,
  },
  {
    name: "Make a video with code",
    description: "Make a short animated MP4 video with code when no generator works",
    body: `Use this when someone asks for a video and generate_video is missing or fails. You make motion graphics with code and render them with ffmpeg on your computer.

1. Write a short plan: 10–30 s, 3–5 scenes, one line of text each, a palette, and the motion (fades, slides, scale, easing). 1280×720 (or 1080×1920 for vertical) at 30 fps.
2. Install once: \`pip install --quiet pillow numpy\` (ffmpeg is already there). Download a good font, e.g. \`curl -sL -o ~/Inter.ttf https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Bold.otf\`.
3. Write ~/video/render.py: for each frame t, draw with Pillow (gradient background, shapes, text with ImageFont.truetype), using easing (e.g. 1-(1-x)**3) so motion is smooth, and write raw RGB bytes to ffmpeg's stdin:
   \`ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 30 -i - -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart ~/video/out.mp4\`
   Keep the work light (2 CPUs): draw at the final size, reuse the background, no per-pixel Python loops (use numpy). Test with 1 s first (\`--seconds 1\`), then render the whole video in the background so it does not hit the shell's time limit: \`nohup python3 ~/video/render.py > ~/video/render.log 2>&1 &\` and check \`tail -2 ~/video/render.log; ls -la ~/video/out.mp4\` every 30 s until it is done.
4. Check it: \`ffprobe -v error -show_entries format=duration -of csv=p=0 ~/video/out.mp4\`, and pull 3 stills (\`ffmpeg -ss 2 -i out.mp4 -frames:v 1 s1.png\`) and look at them with open_path. Fix anything ugly and render again.
5. Optional sound: a soft pad with \`ffmpeg -f lavfi -i "sine=frequency=220:duration=20" ...\` mixed low, or none.
6. attach_file the MP4 with a name and description, and say its length and size. Never say the video is ready unless ffprobe showed its duration in this chat.`,
  },
];
