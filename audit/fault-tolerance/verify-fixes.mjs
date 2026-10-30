import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
const now = new Date().toISOString();
const customerId = "11111111-1111-4111-8111-111111111111";
const formalId = "22222222-2222-4222-8222-222222222222";
const trialId = "33333333-3333-4333-8333-333333333333";
let trialDeleted = false;

const user = {
  id: customerId,
  username: "customer",
  real_name: "普通用户",
  phone: "13800000001",
  role: "customer",
  organization: "测试单位"
};
const reports = [
  {
    id: formalId,
    source_type: "formal",
    project_id: "55555555-5555-4555-8555-555555555555",
    detection_task_id: null,
    report_no: "RPT-2026-0001",
    title: "正式交付报告",
    status: "pushed",
    project_name: "正式项目",
    client_name: "客户",
    address: "深圳",
    total_defects: 2,
    photo_count: 3,
    generated_at: now,
    pushed_at: now,
    updated_at: now
  },
  {
    id: trialId,
    source_type: "trial",
    project_id: null,
    detection_task_id: null,
    report_no: "TRY-2026-0001",
    title: "可恢复简易结果",
    status: "generated",
    project_name: "智能检测",
    client_name: null,
    address: null,
    total_defects: 0,
    photo_count: 1,
    generated_at: now,
    pushed_at: null,
    updated_at: now
  }
];

await page.route("**/api/auth/login", (route) => route.fulfill({
  contentType: "application/json",
  status: 200,
  body: JSON.stringify({
    access_token: "fault-tolerance-verification-token",
    token_type: "bearer",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    user
  })
}));
await page.route("**/api/auth/me", (route) => route.fulfill({
  contentType: "application/json",
  status: 200,
  body: JSON.stringify(user)
}));
await page.route("**/api/reports", (route) => route.fulfill({
  contentType: "application/json",
  status: 200,
  body: JSON.stringify(reports.filter((report) => report.source_type === "formal" || !trialDeleted))
}));
await page.route(`**/api/reports/${trialId}`, (route) => {
  if (route.request().method() !== "DELETE") return route.continue();
  trialDeleted = true;
  return route.fulfill({ contentType: "application/json", status: 200, body: JSON.stringify({ ok: true }) });
});
await page.route(`**/api/reports/${trialId}/restore`, (route) => {
  trialDeleted = false;
  return route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({ id: trialId, source_type: "trial", title: "可恢复简易结果" })
  });
});

await page.goto("http://127.0.0.1:5175/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "登录" }).click();
await page.getByRole("button", { name: "注册账号" }).click();
await page.getByPlaceholder("再次输入密码").waitFor();
await page.getByPlaceholder("用于后续登录").fill("unsaved-user");
let registrationWarning = "";
page.once("dialog", async (dialog) => {
  registrationWarning = dialog.message();
  await dialog.dismiss();
});
await page.getByRole("button", { name: "返回登录" }).click();
if (!registrationWarning.includes("放弃")) throw new Error("注册未保存切换提示未出现");
if (!await page.getByPlaceholder("用于后续登录").isVisible()) throw new Error("取消放弃后注册表单未保留");

page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "返回登录" }).click();
await page.getByLabel("用户名或手机号").fill("customer");
await page.getByPlaceholder("请输入密码").fill("Customer123!");
await page.locator(".auth-login-form").getByRole("button", { name: "登录" }).click();
await page.locator(".account-trigger").waitFor();

await page.goto("http://127.0.0.1:5175/capabilities/time", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "查询推荐时段" }).click();
const dateInput = page.getByLabel("选择日期");
if (!await dateInput.getAttribute("min") || !await dateInput.getAttribute("max")) {
  throw new Error("推荐日期范围未限制");
}
await page.getByRole("button", { name: "取消" }).click();

await page.goto("http://127.0.0.1:5175/reports", { waitUntil: "networkidle" });
const formalRow = page.locator("tr", { hasText: "正式交付报告" });
const trialRow = page.locator("tr", { hasText: "可恢复简易结果" });
if (await formalRow.getByRole("button", { name: "删除" }).count()) {
  throw new Error("普通用户仍可删除正式报告");
}
if (await trialRow.getByRole("button", { name: "删除" }).count() !== 1) {
  throw new Error("简易结果删除入口缺失");
}
page.once("dialog", (dialog) => dialog.accept());
await trialRow.getByRole("button", { name: "删除" }).click();
await page.getByRole("button", { name: "撤销删除" }).waitFor();
await page.getByRole("button", { name: "撤销删除" }).click();
await page.getByText("可恢复简易结果").waitFor();

console.log(JSON.stringify({
  registrationUnsavedWarning: true,
  registrationConfirmationPassword: true,
  recommendationDateRange: true,
  customerFormalDeleteHidden: true,
  trialDeleteUndo: true
}));
await browser.close();
