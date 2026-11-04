import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const auditDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(auditDir, "screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });

const observations = [];
const dialogEvents = [];
const consoleErrors = [];
const today = new Date();
const todayText = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0")
].join("-");
const nowIso = today.toISOString();
const customerId = "11111111-1111-4111-8111-111111111111";
const formalReportId = "22222222-2222-4222-8222-222222222222";
const trialReportId = "33333333-3333-4333-8333-333333333333";
const trialPhotoId = "44444444-4444-4444-8444-444444444444";
const trialProjectNo = "TRY-2026-0001";

function observe(step, result) {
  observations.push({ step, result });
}

async function domSnapshot(page) {
  return page.locator("body").ariaSnapshot();
}

async function click(page, locator) {
  await domSnapshot(page);
  await locator.click();
}

async function fill(page, locator, value) {
  await domSnapshot(page);
  await locator.fill(value);
}

async function shot(page, filename) {
  const target = path.join(screenshotDir, filename);
  await page.screenshot({ path: target, fullPage: true });
  observe(filename, {
    title: await page.title(),
    url: page.url(),
    viewport: await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth
    }))
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  colorScheme: "light",
  locale: "zh-CN",
  reducedMotion: "reduce",
  viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("dialog", async (dialog) => {
  dialogEvents.push({ message: dialog.message(), type: dialog.type(), url: page.url() });
  await dialog.dismiss();
});

await page.route("**/api/auth/login", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      access_token: "browser-audit-token",
      token_type: "bearer",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: {
        id: customerId,
        username: "customer",
        real_name: "普通用户",
        phone: "13800000001",
        role: "customer",
        organization: "外墙巡检示例单位"
      }
    })
  });
});
await page.route("**/api/auth/me", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      id: customerId,
      username: "customer",
      real_name: "普通用户",
      phone: "13800000001",
      role: "customer",
      organization: "外墙巡检示例单位"
    })
  });
});
await page.route("**/api/accounts/me/usage", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      account_id: customerId,
      period_start: todayText,
      period_end: todayText,
      usage: {
        task_count: 1,
        formal_task_count: 0,
        trial_task_count: 1,
        api_request_count: 4,
        token_count: 1200,
        input_token_count: 900,
        output_token_count: 300
      },
      trial_api_request_balance: { limit: 800, used: 4, remaining: 796 }
    })
  });
});

await page.goto("http://127.0.0.1:5175/", { waitUntil: "networkidle" });
await click(page, page.getByRole("button", { name: "登录" }));
await page.getByRole("dialog").waitFor();
await shot(page, "01-login.png");

await click(page, page.getByRole("button", { name: "注册账号" }));
await page.getByPlaceholder("用于后续登录").waitFor();
await fill(page, page.getByPlaceholder("用于后续登录"), "fault-tolerance-audit");
await fill(page, page.getByPlaceholder("至少 8 位"), "AuditPass123!");
await fill(page, page.getByPlaceholder("请输入11位手机号码"), "19900000000");
await shot(page, "02-register-unsaved.png");
await click(page, page.locator(".auth-dialog .auth-close"));
await click(page, page.getByRole("button", { name: "登录" }));
await click(page, page.getByRole("button", { name: "注册账号" }));
observe("register-close-recovery", {
  usernameAfterReopen: await page.getByPlaceholder("用于后续登录").inputValue(),
  destructivePromptShown: dialogEvents.length > 0
});

await click(page, page.getByRole("button", { name: "返回登录" }));
await fill(page, page.getByLabel("用户名或手机号"), "customer");
await fill(page, page.getByLabel("密码"), "Customer123!");
await click(page, page.locator(".auth-login-form").getByRole("button", { name: "登录" }));
await page.locator(".account-trigger").waitFor();

await click(page, page.locator(".account-trigger"));
await click(page, page.getByRole("button", { name: "个人信息" }));
await page.getByRole("dialog", { name: "个人信息" }).waitFor();
await click(page, page.getByRole("button", { name: "编辑资料" }));
await fill(page, page.getByLabel("姓名"), "未保存的姓名");
await fill(page, page.getByLabel("所属单位"), "未保存的单位");
await shot(page, "03-account-unsaved-edit.png");
const accountDialogsBeforeClose = dialogEvents.length;
await click(page, page.locator(".personal-info-dialog .auth-close"));
await click(page, page.locator(".account-trigger"));
await click(page, page.getByRole("button", { name: "个人信息" }));
observe("account-close-recovery", {
  destructivePromptShown: dialogEvents.length > accountDialogsBeforeClose,
  editingRestored: await page.getByText("未保存的姓名").count() > 0
});
await click(page, page.getByRole("button", { name: "修改密码" }));
await page.getByRole("dialog", { name: "修改密码" }).waitFor();
await shot(page, "04-change-password.png");
await click(page, page.locator(".change-password-modal .auth-close"));

await page.goto("http://127.0.0.1:5175/capabilities/time", { waitUntil: "networkidle" });
await click(page, page.getByRole("button", { name: "查询推荐时段" }));
await page.getByRole("dialog", { name: "检测时段推荐" }).waitFor();
const mapReady = await page.locator(".map-stage #project-map:not(.map-unavailable)").waitFor({
  state: "visible",
  timeout: 10000
}).then(() => true).catch(() => false);
if (mapReady) {
  const mapBox = await page.locator(".map-stage").boundingBox();
  if (mapBox) {
    await domSnapshot(page);
    await page.mouse.click(mapBox.x + mapBox.width * 0.58, mapBox.y + mapBox.height * 0.46);
  }
  await fill(page, page.getByLabel("输入检测位置"), "这是尚未执行搜索定位的新地址");
}
await shot(page, "05-time-recommendation-input.png");
observe("time-address-coordinate-consistency", {
  mapReady,
  queryEnabledAfterAddressChangedWithoutSearch: mapReady
    ? await page.getByRole("button", { name: "查询推荐", exact: true }).isEnabled()
    : false
});

await page.route("**/api/weather/daily?**", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      code: "200",
      update_time: nowIso,
      fx_link: null,
      refer: null,
      daily: [{
        fx_date: todayText,
        sunrise: "05:45",
        sunset: "19:05",
        moonrise: null,
        moonset: null,
        moon_phase: null,
        moon_phase_icon: null,
        temp_max_c: 32,
        temp_min_c: 25,
        icon_day: null,
        text_day: "多云",
        icon_night: null,
        text_night: "多云",
        wind360_day: 120,
        wind_dir_day: "东南风",
        wind_scale_day: "3",
        wind_speed_day_kmh: 14,
        wind360_night: 90,
        wind_dir_night: "东风",
        wind_scale_night: "2",
        wind_speed_night_kmh: 9,
        humidity_percent: 72,
        precip_mm: 0,
        pressure_hpa: 1002,
        visibility_km: 18,
        cloud_percent: 55,
        uv_index: 7
      }]
    })
  });
});
await page.route("**/api/weather/hourly?**", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    status: 503,
    body: JSON.stringify({ code: "weather_unavailable", message: "逐小时预报服务暂不可用" })
  });
});
if (mapReady) {
  await click(page, page.getByRole("button", { name: "查询推荐", exact: true }));
  await page.getByText("计算过程与判断逻辑").waitFor({ timeout: 10000 });
  await shot(page, "06-time-recommendation-fallback.png");
}
await click(page, page.getByRole("button", { name: /完成|取消/ }));

let trialPhotoUploadCount = 0;
let trialDeleteCount = 0;
let trialGenerateCount = 0;
let trialTitlePatchCount = 0;
await page.route("**/api/trial/photos", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  trialPhotoUploadCount += 1;
  await route.fulfill({
    contentType: "application/json",
    status: 201,
    body: JSON.stringify({
      id: trialPhotoId,
      original_filename: "裂缝.jpeg",
      file_size: 73501,
      mime_type: "image/jpeg",
      metadata_json: {},
      thermal_imaging_available: false,
      created_at: nowIso
    })
  });
});
await page.route("**/api/trial/photos/*", async (route) => {
  if (route.request().method() !== "DELETE") return route.continue();
  trialDeleteCount += 1;
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({ ok: true })
  });
});
await page.route("**/api/trial/generate", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  trialGenerateCount += 1;
  const body = route.request().postDataJSON();
  const title = body.report_name || trialProjectNo;
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      report_name: title,
      generated_at: nowIso,
      models: body.models,
      files: [{ photo_id: trialPhotoId, filename: "裂缝.jpeg", size: 73501 }],
      findings: [{
        photo_id: trialPhotoId,
        filename: "裂缝.jpeg",
        model: "裂缝",
        confidence: 0.92,
        bbox: { x: 150, y: 120, width: 260, height: 360 },
        image_width: 1280,
        image_height: 960,
        detection_id: "audit-detection-1",
        description: "疑似竖向裂缝"
      }],
      raw_model_outputs: [],
      archived_report_id: trialReportId,
      archived_report_title: title
    })
  });
});
await page.route(`**/api/reports/${trialReportId}`, async (route) => {
  if (route.request().method() === "PATCH") {
    trialTitlePatchCount += 1;
    return route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ id: trialReportId, title: route.request().postDataJSON().title })
    });
  }
  return route.continue();
});

await page.goto("http://127.0.0.1:5175/trial", { waitUntil: "networkidle" });
await shot(page, "07-trial-empty.png");
const trialImagePath = path.resolve(
  auditDir,
  "../../frontend/public/images/trial/examples/original/裂缝.jpeg"
);
await page.locator('input[type="file"]').setInputFiles(trialImagePath);
await page.getByText("上传完成 1/1").waitFor();
await shot(page, "08-trial-uploaded.png");
const dialogsBeforeTrialDelete = dialogEvents.length;
await domSnapshot(page);
await page.locator(".trial-photo-thumb-actions .danger").click({ force: true });
await page.getByText("点击或拖拽照片到此处上传").waitFor();
observe("trial-photo-delete", {
  deleteRequestSent: trialDeleteCount === 1,
  destructivePromptShown: dialogEvents.length > dialogsBeforeTrialDelete
});

await page.locator('input[type="file"]').setInputFiles(trialImagePath);
await page.getByText("上传完成 1/1").waitFor();
await fill(page, page.locator("#trial-report-name"), "浏览器容错验证报告");
await click(page, page.getByRole("button", { name: "生成检测结果" }));
await page.getByText("检测完成，已自动存档到检测结果。").waitFor({ timeout: 10000 });
await shot(page, "09-trial-result.png");
await fill(page, page.locator("#trial-report-name"), "尚未保存的新名称");
const dialogsBeforeTrialExit = dialogEvents.length;
await click(page, page.getByRole("button", { name: "完成并退出" }));
await page.waitForURL("http://127.0.0.1:5175/");
observe("trial-exit-with-dirty-title", {
  destructivePromptShown: dialogEvents.length > dialogsBeforeTrialExit,
  generateCount: trialGenerateCount,
  titlePatchCount: trialTitlePatchCount,
  uploadCount: trialPhotoUploadCount
});

const reportList = [
  {
    id: formalReportId,
    source_type: "formal",
    project_id: "55555555-5555-4555-8555-555555555555",
    detection_task_id: "66666666-6666-4666-8666-666666666666",
    report_no: "RPT-2026-0001",
    title: "已推送正式检测结果",
    status: "pushed",
    project_name: "外墙巡检示例项目",
    client_name: "示例客户",
    address: "深圳市",
    total_defects: 8,
    photo_count: 12,
    generated_at: nowIso,
    pushed_at: nowIso,
    updated_at: nowIso
  },
  {
    id: trialReportId,
    source_type: "trial",
    project_id: null,
    detection_task_id: null,
    report_no: trialProjectNo,
    title: "智能检测体验结果",
    status: "generated",
    project_name: "智能检测",
    client_name: null,
    address: null,
    total_defects: 1,
    photo_count: 1,
    generated_at: nowIso,
    pushed_at: null,
    updated_at: nowIso
  }
];
await page.route("**/api/reports", async (route) => {
  if (route.request().method() !== "GET") return route.continue();
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify(reportList)
  });
});
await page.route(`**/api/reports/${trialReportId}`, async (route) => {
  if (route.request().method() !== "GET") return route.continue();
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      id: trialReportId,
      source_type: "trial",
      project_id: null,
      detection_task_id: null,
      report_no: trialProjectNo,
      title: "智能检测体验结果",
      status: "generated",
      report_data_json: {},
      project: {},
      buildings: [],
      detection_config: null,
      detection_task: null,
      summary: {
        total_review_results: 1,
        by_defect_type: { crack: 1 },
        by_status: { generated: 1 },
        photo_count: 1,
        thermal_available_photo_count: 0
      },
      defects: [{
        id: "77777777-7777-4777-8777-777777777777",
        photo_id: trialPhotoId,
        photo_filename: "裂缝.jpeg",
        photo_preview_url: "/images/trial/examples/original/裂缝.jpeg",
        defect_type: "crack",
        bbox_json: { x: 150, y: 120, width: 260, height: 360 },
        status: "generated",
        confidence: "0.92",
        raw_result_json: { finding: { image_width: 1280, image_height: 960 } }
      }],
      photos: [{
        id: trialPhotoId,
        original_filename: "裂缝.jpeg",
        mime_type: "image/jpeg",
        image_width: 1280,
        image_height: 960,
        preview_url: "/images/trial/examples/original/裂缝.jpeg",
        thumbnail_url: "/images/trial/examples/original/裂缝.jpeg",
        thermal_imaging_available: false,
        metadata_json: {}
      }],
      raw_model_outputs: [],
      docx_bucket: null,
      docx_object_key: null,
      generated_by: customerId,
      generated_at: nowIso,
      pushed_at: null,
      created_at: nowIso,
      updated_at: nowIso
    })
  });
});

await page.goto("http://127.0.0.1:5175/reports", { waitUntil: "networkidle" });
await page.getByText("已推送正式检测结果").waitFor();
await shot(page, "10-results-list.png");
const dialogsBeforeFormalDelete = dialogEvents.length;
await click(
  page,
  page.locator("tr", { hasText: "已推送正式检测结果" }).getByRole("button", { name: "删除" })
);
observe("formal-report-delete-confirmation", {
  dialog: dialogEvents.at(-1) ?? null,
  dialogShown: dialogEvents.length > dialogsBeforeFormalDelete
});
await click(
  page,
  page.locator("tr", { hasText: "智能检测体验结果" }).getByRole("link", { name: "查看结果" })
);
await page.getByText("检测结果明细").waitFor();
await shot(page, "11-result-detail.png");

observe("console-errors", consoleErrors);
fs.writeFileSync(
  path.join(auditDir, "observations.json"),
  `${JSON.stringify(observations, null, 2)}\n`
);
await browser.close();
