import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
await context.addInitScript((token) => {
  localStorage.setItem('building-exterior-access-token', token);
  localStorage.setItem('exterior-wall:hide-trial-version-notice', 'true');
}, config.token);
const observations = [];
const pageErrors = [];
const uploadIds = [];
try {
  for (const [kind, route, endpoint] of [
    ['trial', '/trials/new', '/api/trial/photos'],
    ['formal', `/detections/${config.projectId}`, '/api/photos/upload'],
  ]) {
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1${route}`, { waitUntil: 'domcontentloaded' });
    const fileInput = page.locator('input[type=file]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST', { timeout: 120000 });
    await fileInput.setInputFiles(config.samplePath);
    const response = await uploaded;
    const body = await response.json();
    uploadIds.push({ kind, id: body.id });
    assert.equal(response.status(), 201, JSON.stringify(body));
    assert.equal(body.precheck_status, 'passed', JSON.stringify(body));
    const image = page.locator(`img[alt="${config.sampleName}"]`).first();
    await image.waitFor({ state: 'visible' });
    await page.waitForFunction(name => [...document.images].some(img => img.alt === name && img.complete && img.naturalWidth > 0), config.sampleName);
    await page.screenshot({ path: `audit/photo-upload/${kind}-uploaded.png`, fullPage: true });
    observations.push({ kind, status: response.status(), bytes: body.file_size, precheck: body.precheck_status, imageLoaded: true });
    await page.close();
  }
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ observations, pageErrors, uploadIds }));
} catch (error) {
  console.log(JSON.stringify({ observations, pageErrors, uploadIds, error: error.message }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
