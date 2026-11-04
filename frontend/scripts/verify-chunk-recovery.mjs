import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
try {
  for (const source of ["trial", "formal"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/reports/chunk-test", route => route.fulfill({ json: {
      id: "chunk-test", source_type: source, title: "详情页回归测试", report_no: "TEST",
      project: { name: "详情页回归测试", project_no: "TEST" },
      generated_at: "2026-10-13T03:00:00Z", is_example: true,
      photos: [], defects: [], raw_model_outputs: [], building_model_images: [],
      detection_config: null, detection_task: null, summary: {}, report_data_json: null
    } }));
    const path = source === "trial" ? "/trials/chunk-test" : "/detections/results/chunk-test";
    await page.goto(`${base}${path}`);
    await page.locator(".trial-result-detail-page").waitFor();
    assert.deepEqual(errors, []);
    console.log(`${source}: detail rendered without module errors`);
    await page.close();
  }

  for (const persistent of [false, true]) {
    const page = await browser.newPage();
    let attempts = 0;
    let navigations = 0;
    page.on("request", request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
    });
    await page.route("**/assets/ReportDetailPage-*.js", route => {
      attempts++;
      return persistent || attempts === 1 ? route.abort() : route.continue();
    });
    await page.route("**/api/reports/chunk-test", route => route.fulfill({ status: 404, json: { detail: "测试结果不存在" } }));
    await page.goto(`${base}/trials/chunk-test`);
    if (persistent) {
      await page.getByRole("heading", { name: "页面加载失败" }).waitFor();
      await page.getByRole("button", { name: "刷新页面" }).waitFor();
    } else {
      await page.getByRole("heading", { name: "结果加载失败" }).waitFor();
    }
    assert.equal(navigations, 2, "exactly one automatic reload");
    assert.equal(attempts, 2);
    console.log(persistent ? "persistent failure: one reload and manual recovery shown" : "transient failure: automatic recovery succeeded");
    await page.close();
  }
} finally {
  await browser.close();
}
