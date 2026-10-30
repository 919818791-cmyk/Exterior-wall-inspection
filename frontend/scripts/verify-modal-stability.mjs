import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Run against Vite or the built app. Every API request is mocked: no detection is submitted.
const base = process.argv[2] || "http://127.0.0.1";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--disable-gpu"] });
const user = { id: "modal-test", username: "modal-test", real_name: "弹窗测试", role: "customer", phone: null, organization: null };
const balance = { limit: 1000, remaining: 1000, used: 0 };
const photo = {
  id: "modal-photo", original_filename: "facade.png", file_size: 68, mime_type: "image/png",
  metadata_json: {}, thermal_imaging_available: false, precheck_status: "passed",
  precheck_category: "BUILDING", precheck_reason: null, precheck_model: null,
  precheck_error: null, precheck_attempts: 1, prechecked_at: "2026-10-21T00:00:00Z", created_at: "2026-10-21T00:00:00Z"
};
const result = {
  archived_report_id: "modal-report", archived_report_title: "弹窗测试", generated_at: "2026-10-21T00:00:00Z",
  models: ["裂缝"], files: [{ photo_id: photo.id, filename: photo.original_filename, size: 68 }], findings: []
};

async function startSampling(page) {
  await page.evaluate(() => {
    const background = document.querySelector(".trial-new-project-layout");
    const backgroundRect = () => {
      const { x, y, width, height } = background.getBoundingClientRect();
      return [x, y, width, height];
    };
    const state = { stopped: false, frames: [], before: backgroundRect(), scrollY: window.scrollY };
    window.modalStability = state;
    const sample = () => {
      if (state.stopped) return;
      const opacities = selector => [...document.querySelectorAll(selector)].map(node => getComputedStyle(node).opacity);
      state.frames.push({
        wrappers: opacities(".start-detection-modal-wrapper, .trial-detection-modal-wrapper"),
        backdrops: opacities(".start-detection-modal-backdrop, .trial-detection-modal-backdrop"),
        background: backgroundRect(), scrollY: window.scrollY,
        overflowing: document.documentElement.scrollWidth > window.innerWidth
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function checkSampling(page, label) {
  const data = await page.evaluate(() => {
    window.modalStability.stopped = true;
    return window.modalStability;
  });
  const first = data.frames.findIndex(frame => frame.wrappers.length);
  assert.ok(first >= 0, `${label}: dialog opened`);
  const frames = data.frames.slice(first);
  assert.ok(frames.length > 20, `${label}: enough rendered frames`);
  for (const [index, frame] of frames.entries()) {
    assert.deepEqual(frame.wrappers, ["1"], `${label}, frame ${index}: one fully visible dialog`);
    assert.deepEqual(frame.backdrops, ["1"], `${label}, frame ${index}: one fully visible backdrop`);
    assert.deepEqual(frame.background, data.before, `${label}: background layout preserved`);
    assert.equal(frame.scrollY, data.scrollY, `${label}: scroll position preserved`);
    assert.equal(frame.overflowing, false, `${label}: no horizontal overflow`);
  }
  console.log(`${label}: ${frames.length} frames without disappearing, fading or overlapping overlays`);
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const outcome of ["completed", "failed"]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      let releaseGeneration;
      const generation = new Promise(resolve => { releaseGeneration = resolve; });
      await page.addInitScript(() => {
        localStorage.setItem("building-exterior-access-token", "mock-modal-token");
        localStorage.setItem("exterior-wall:hide-trial-version-notice", "true");
      });
      await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        if (path === "/api/auth/me") return route.fulfill({ json: user });
        if (path === "/api/accounts/me/usage") return route.fulfill({ json: {
          trial_photo_detection_balance: balance, formal_photo_detection_balance: balance, usage: {}
        } });
        if (path === "/api/trial/photos") return route.fulfill({ json: photo });
        if (path.startsWith("/api/trial/requests/")) return route.fulfill({ json: { status: "processing", result: null, error: null } });
        if (path === "/api/trial/generate") {
          await generation;
          return outcome === "completed"
            ? route.fulfill({ json: result })
            : route.fulfill({ status: 500, json: { message: "模拟检测失败" } });
        }
        return route.fulfill({ status: 404, json: { detail: "Unexpected mocked API request" } });
      });
      try {
        await page.goto(`${base}/trials/new`);
        await page.locator("input[type=file]").setInputFiles({
          name: "facade.png", mimeType: "image/png",
          buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1EAAAAASUVORK5CYII=", "base64")
        });
        await page.getByRole("button", { name: "开始检测", exact: true }).waitFor();
        // Wait for the mocked upload, so the first click opens the settings instead of a validation notice.
        await page.waitForFunction(() => !document.querySelector(".new-project-photo-upload-indicator"));
        const settings = page.getByRole("dialog", { name: "检测设置", exact: true });
        for (let attempt = 0; attempt < 2; attempt++) {
          await startSampling(page);
          await page.locator(".professional-create-submit").click();
          await settings.waitFor();
          await page.waitForTimeout(1000);
          await checkSampling(page, `${viewport.width} ${outcome}: settings open ${attempt + 1}`);
          if (attempt === 0) {
            await page.keyboard.press("Escape");
            await settings.waitFor({ state: "detached" });
          }
        }
        // Nested validation must leave the settings available, with the selected types preserved.
        const crack = settings.getByRole("checkbox", { name: "裂缝" });
        await crack.uncheck();
        await settings.getByRole("button", { name: "开始检测", exact: true }).click();
        const notice = page.getByRole("dialog", { name: "错误提示" });
        await notice.getByText("请至少勾选一种检测类型。").waitFor();
        await notice.getByRole("button", { name: "我知道了" }).click();
        await notice.waitFor({ state: "detached" });
        await crack.check();

        await startSampling(page);
        await settings.getByRole("button", { name: "开始检测", exact: true }).click();
        const progress = page.getByRole("dialog", { name: "检测进行中", exact: true });
        await progress.waitFor();
        await page.waitForTimeout(1800);
        await page.keyboard.press("Escape");
        await page.mouse.click(4, 4);
        await progress.waitFor();
        await checkSampling(page, `${viewport.width} ${outcome}: settings to progress, progress updates`);
        assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "42");

        await page.evaluate(() => { window.progressDialog = document.querySelector(".trial-detection-modal-content"); });
        await startSampling(page);
        releaseGeneration();
        const finished = page.getByRole("dialog", { name: outcome === "completed" ? "已完成" : "检测状态异常", exact: true });
        await finished.waitFor();
        await page.waitForTimeout(1000);
        await checkSampling(page, `${viewport.width}: progress to ${outcome}`);
        assert.equal(await page.evaluate(() => window.progressDialog === document.querySelector(".trial-detection-modal-content")), true,
          "progress and outcome reuse the same dialog node");
        if (outcome === "completed") {
          assert.equal(await finished.getByRole("button", { name: "查看结果" }).isEnabled(), true);
        } else {
          await finished.getByRole("button", { name: "确认", exact: true }).click();
          await finished.waitFor({ state: "detached" });
          assert.equal(await page.locator(".trial-detection-modal-backdrop").count(), 0);
        }
        assert.deepEqual(errors, []);
      } finally {
        releaseGeneration();
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
