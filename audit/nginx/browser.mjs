import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";
let token = "";
for await (const chunk of process.stdin) token += chunk;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "zh-CN" });
await context.addInitScript((value) => localStorage.setItem("building-exterior-access-token", value), token.trim());
const page = await context.newPage();
const failures = [];
const pageErrors = [];
const routes = [];
const failedRequests = [];
const mapResponses = [];
let mapCheck = {};
page.on("response", response => {
  const url = new URL(response.url());
  if (url.origin === "http://127.0.0.1" && response.status() >= 400) {
    failures.push({ path: url.pathname, status: response.status() });
  }
  if (url.pathname.startsWith("/_AMapService/")) mapResponses.push({ path: url.pathname, status: response.status() });
});
page.on("requestfailed", request => {
  const url = new URL(request.url());
  if (url.origin === "http://127.0.0.1" && request.failure()?.errorText !== "net::ERR_ABORTED") failedRequests.push({ path: url.pathname, error: request.failure()?.errorText });
});
page.on("pageerror", error => pageErrors.push(error.name));
try {
  for (const path of ["/", "/model-management", "/detection-prompts", "/system-settings", "/detections", "/trials", "/photos", "/trials/new", "/detections/new"]) {
    const response = await page.goto(`http://127.0.0.1${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    routes.push({ path, status: response.status(), finalPath: new URL(page.url()).pathname });
  }
  await page.goto("http://127.0.0.1/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "查询检测时段" }).click();
  await page.locator(".amap-maps").waitFor({ state: "visible", timeout: 15000 });
  const address = page.getByLabel("输入检测位置");
  await address.fill("深圳市南山区");
  const geocode = page.waitForResponse(response => new URL(response.url()).pathname.startsWith("/_AMapService/v3/geocode/"), { timeout: 15000 });
  await address.press("Enter");
  const mapResult = await geocode;
  const mapBody = await mapResult.text();
  const mapData = JSON.parse(mapBody.slice(mapBody.indexOf("{"), mapBody.lastIndexOf("}") + 1));
  mapCheck = { rendered: true, geocodeStatus: mapResult.status(), upstreamStatus: mapData.status, upstreamInfo: mapData.info };
  console.log(JSON.stringify({ routes, failures, pageErrors, failedRequests, mapResponses, mapCheck }));
} finally {
  await browser.close();
}
if (failures.length || pageErrors.length || failedRequests.length || mapCheck.upstreamStatus !== "1" || routes.some(route => route.status !== 200 || route.finalPath === "/login")) process.exitCode = 1;
