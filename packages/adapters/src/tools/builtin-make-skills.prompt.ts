// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Built-in recipes for the three things people most often ask a bot to make in one chat: a small
// working app, a published website, and a short video made with code. They were written from
// test chats where the model knew how to write files but not how to put a site online (no
// account), what the cloud computer lacks (Node, Pillow) or how to turn an animation into an MP4.
// Checked on the cloud computer on 2026-11-22: ffmpeg and python3 are there; node and Pillow are
// not; `vercel deploy --temporary` works without an account. Who reads this: builtin-skills.

import { MOTION_KIT_PY } from "./builtin-motion-kit.prompt.js";

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
3. The output has the live URL (https://….tmp.now) and a claim link. Copy both exactly from the output. Check the site loads with \`curl -s -o /dev/null -w '%{http_code}' <url>\`: it must print 200 (this works even when you cannot see the screen). On 404, run the deploy again from the folder that holds index.html. Then give the user both: the live link, and the claim link with this note: "It stays live for 60 minutes; open the claim link and sign in to Vercel (free) to keep it." Running the same command again in the same folder updates the same site.
Never say a site is published unless the command printed its URL in this chat.`,
  },
  {
    name: "Make a video with code",
    description: "Make a short animated MP4 video with code when no generator works",
    body: `Use this when someone asks for a video and generate_video is missing or fails. You make a motion-graphics video with code on your computer, using the tested motion kit below so it looks good even when you cannot see pictures.

1. Plan 3 to 5 scenes for 10 to 30 s. Each scene: a kicker (2 to 4 words), a title (at most 4 words), an optional line (at most 8 words), its seconds, and optional "rule": true (a thin line under it) and "glow" (0.5 to 1.2). Pick a palette for the brand: top, bottom (background gradient), glow, title, accent, text as hex colors.
2. Set up once:
   \`mkdir -p ~/video && cd ~/video && pip install --quiet pillow numpy && curl -sL -o display.ttf "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" && curl -sL -o body.otf https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Medium.otf\`
   (Another display font from github.com/google/fonts works too; save it as display.ttf.)
3. Write ~/video/motion.py with write_file, exactly as the kit below, and ~/video/scenes.json like:
   {"palette": {"top": "#140b07", "bottom": "#3e1f10", "glow": "#d9702a", "title": "#f6e7d2", "accent": "#e8a34c", "text": "#d9c3a5"}, "scenes": [{"seconds": 4, "kicker": "Introducing", "title": "Hearthstone", "title_scale": 0.17, "rule": true}]}
   "title_scale" is the title height as a share of the frame (0.09 for long titles, up to 0.17 for one word). "music_hz" (optional) is a list of three notes for the soft pad.
4. Try 2 s: \`cd ~/video && python3 motion.py scenes.json test.mp4 --seconds 2\`. Then render the whole video in the background (the shell stops long commands): \`cd ~/video && nohup python3 motion.py scenes.json out.mp4 > render.log 2>&1 &\` and check \`tail -1 ~/video/render.log\` every 30 s until it prints done.
5. Check it before you send it: \`ffprobe -v error -show_entries format=duration -of csv=p=0 ~/video/out.mp4\`, then measure a frame in each scene with numbers (this works without sight):
   \`python3 -c "import subprocess,numpy as np
for t in [1,4,8,11,14]:
  a=np.frombuffer(subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i','$HOME/video/out.mp4','-frames:v','1','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout,np.uint8).reshape(720,1280)
  y,x=np.where(a>140); print(t,'mean',round(a.mean()),'text box',(x.min(),y.min(),x.max(),y.max()) if len(x) else None)"\`
   Use times inside your scenes. Each mean should be 12 or more and each scene should show a text box whose middle ((x0+x1)/2) is near 640. If a check fails, fix scenes.json (shorter text, smaller title_scale) and render again.
6. attach_file ~/video/out.mp4 with a name and description. Say its length, and say plainly how you checked it (by numbers, or by eye if you could see stills). Never say the video is ready unless ffprobe showed its duration in this chat.
To change the video later, edit scenes.json and render again. Only write your own renderer if the user asks for something the kit cannot do, and then keep the same checks.

The motion kit (motion.py):
\`\`\`python
${MOTION_KIT_PY}
\`\`\``,
  },
];
