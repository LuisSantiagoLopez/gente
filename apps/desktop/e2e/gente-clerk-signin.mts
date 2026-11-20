// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Signs a Clerk development-instance test user in through the real browser
// flow (PKCE, loopback), then calls Gente Cloud with the token.
//   GENTE_CLERK_TEST_PASSWORD=... npx tsx e2e/gente-clerk-signin.mts
import { chromium } from "playwright";
import { CLERK_DEV, signInWithBrowser } from "../src/main/burrow/clerk-auth.ts";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const shots = process.env.GENTE_CLERK_SHOTS ?? "/tmp/gente-clerk";
let n = 0;
const shot = async (name: string) => page.screenshot({ path: `${shots}/${String(n++).padStart(2, "0")}-${name}.png` });
const tokens = await signInWithBrowser({
  config: { ...CLERK_DEV, scopes: "profile email offline_access" },
  timeoutMs: 180_000,
  open: async (url) => {
    console.log("authorize:", url.slice(0, 90));
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("sign-in");
    await page.locator('input[name="identifier"]').fill(process.env.GENTE_CLERK_TEST_EMAIL ?? "gente-dev-test+clerk_test@example.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(2500);
    await shot("after-email");
    const pw = page.locator('input[name="password"]');
    if (await pw.isVisible().catch(() => false)) {
      await pw.fill(process.env.GENTE_CLERK_TEST_PASSWORD ?? "");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else {
      await page.keyboard.type("424242");
    }
    await page.waitForTimeout(4000);
    await shot("after-secret");
    if (await page.getByText("Check your email").isVisible().catch(() => false)) {
      // Clerk test addresses (+clerk_test) accept the code 424242.
      await page.locator("input").first().click();
      await page.keyboard.type("424242");
      await page.waitForTimeout(4000);
      await shot("after-code");
    }
    const consent = page.getByRole("button", { name: /allow|accept|authorize/i });
    if (await consent.isVisible().catch(() => false)) await consent.click();
    await page.waitForTimeout(3000);
    await shot("end");
  },
});
console.log("access token:", tokens.accessToken.slice(0, 12) + "…", "refresh:", Boolean(tokens.refreshToken), "expires in s:", Math.round((tokens.expiresAt - Date.now()) / 1000));
for (const p of ["/v1/me", "/v1/me/plan"]) {
  const r = await fetch(`https://gente-cloud.vercel.app${p}`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  console.log(p, r.status, (await r.text()).slice(0, 160));
}
await browser.close();
