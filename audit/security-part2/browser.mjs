import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";
import { loadEnv } from "../../frontend/node_modules/vite/dist/node/index.js";

const [configuredBase, blankBase] = process.argv.slice(2);
assert(configuredBase && blankBase, "Pass configured and blank-config Vite base URLs.");
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = loadEnv("development", root, "");
const results = [];
const errors = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.name));
    for (const [base, configured] of [[configuredBase, true], [blankBase, false]]) {
      await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
      const expected = configured ? [env.VITE_CONTACT_BUSINESS_MOBILE, env.VITE_CONTACT_TECHNICAL_MOBILE, env.VITE_CONTACT_LANDLINE] : Array(3).fill("暂未配置");
      assert.deepEqual(await page.locator(".home-contact-number").allTextContents(), expected);
      for (const path of ["/privacy", "/terms"]) {
        await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: path === "/privacy" ? "隐私政策" : "用户服务协议", exact: true }).waitFor();
        const links = await page.locator('.legal-contact-card a[href^="tel:"]').evaluateAll(elements => elements.map(element => element.getAttribute("href")));
        assert.deepEqual(links, configured && path === "/privacy" ? [`tel:${env.VITE_CONTACT_BUSINESS_MOBILE}`, `tel:${env.VITE_CONTACT_LANDLINE}`] : []);
        if (!configured && path === "/privacy") await page.getByText("联系电话暂未配置").waitFor();
        results.push({ width, path, configured, contactsMatch: true });
      }
    }
    await context.close();
  }

  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("building-exterior-access-token", "part2-browser-test-token"));
  await page.route("**/api/auth/me", route => route.fulfill({
    json: {
      id: "00000000-0000-0000-0000-000000000099",
      username: "browser-test", real_name: "测试用户", phone: null,
      role: "customer", organization: null
    }
  }));
  page.on("pageerror", error => errors.push(error.name));
  let configuredSdkLoaded = false;
  page.on("request", request => {
    const actual = new URL(request.url());
    const sdk = new URL(env.VITE_AMAP_SDK_URL);
    if (actual.origin === sdk.origin && actual.pathname === sdk.pathname) {
      assert.equal(actual.searchParams.get("v"), "2.0");
      assert.equal(actual.searchParams.get("key"), env.VITE_AMAP_KEY);
      configuredSdkLoaded = true;
    }
  });
  await page.goto(new URL("/", configuredBase).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "查询检测时段" }).click();
  await page.locator(".amap-maps").waitFor({ state: "visible", timeout: 30000 });
  assert(configuredSdkLoaded);
  results.push({ map: "configured", sdkLoadedFromEnvironment: true, rendered: true });
  await page.goto(new URL("/", blankBase).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "查询检测时段" }).click();
  await page.getByText("地图服务暂未配置", { exact: true }).waitFor();
  assert.equal(await page.locator(".amap-maps").count(), 0);
  results.push({ map: "unconfigured", rendered: false, fallbackShown: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(new URL("browser.json", import.meta.url), JSON.stringify({ results, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ checks: results.length, pageErrors: errors.length }));
} finally {
  await browser.close();
}
