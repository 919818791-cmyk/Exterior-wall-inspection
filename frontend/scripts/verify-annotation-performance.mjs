import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// All APIs and photos are mocked; this never changes a real task.
const base = process.argv[2] || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const photoCount = 12;
const stamp = "2026-10-30T00:00:00Z";
const photos = Array.from({ length: photoCount }, (_, index) => ({
  id: `photo-${index}`, original_filename: `facade-${index}.png`,
  image_width: 3200, image_height: 2400,
  preview_url: `${base}/test-photos/full-${index}.png`,
  thumbnail_url: `${base}/test-photos/thumb-${index}.png`
}));
const defects = photos.flatMap((photo, photoIndex) => Array.from({ length: 100 }, (_, index) => ({
  id: `${photoIndex}-${index}`, photo_id: photo.id, defect_no: `LF-${index + 1}`,
  defect_type: "crack", confidence: "0.9",
  bbox_json: index === 0 ? { x: 200, y: 200, width: 500, height: 400 }
    : { x: 1000 + index % 10 * 180, y: 100 + Math.floor(index / 10) * 200, width: 120, height: 100 }
})));

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const fullRequests = new Set();
    const saves = [];
    const edits = new Map();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("building-exterior-access-token", "mock-annotation-token");
      window.photoDraws = 0;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (source instanceof HTMLImageElement) window.photoDraws++;
        return draw.call(this, source, ...args);
      };
    });
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 3200;
      canvas.height = 2400;
      const context = canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 3200, 2400);
      gradient.addColorStop(0, "#d1d5db");
      gradient.addColorStop(1, "#94a3b8");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 3200, 2400);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.route("**/test-photos/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("full-")) fullRequests.add(path);
      return route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
    });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/auth/me") return route.fulfill({ json: {
        id: "test-reviewer", username: "test-reviewer", real_name: "性能测试", role: "reviewer"
      } });
      if (path === "/api/review/detections/perf-task") return route.fulfill({ json: {
        id: "perf-task", report_id: "perf-report", project_name: "标注性能测试", review_status: "pending"
      } });
      if (path.endsWith("/annotations/photos") && route.request().method() === "PUT") {
        const payload = route.request().postDataJSON();
        saves.push(payload);
        const edit = { ...payload, id: payload.photo_key, edited_by: "test-reviewer", updated_at: stamp };
        edits.set(payload.photo_key, edit);
        return route.fulfill({ json: edit });
      }
      if (path.endsWith("/annotations")) return route.fulfill({ json: {
        result: { id: "perf-report", status: "pending", title: "标注性能测试",
          photos, defects, raw_model_outputs: [], summary: {}, project: {} },
        edits: [...edits.values()], generate_building_model: false,
        has_building_model: false, has_building_model_images: false
      } });
      return route.fulfill({ json: {} });
    });
    try {
      await page.goto(`${base}/review/detections/perf-task`);
      await page.locator(".annotation-editor-pane.is-active canvas").first().waitFor();
      await page.waitForFunction(() => window.Konva?.stages[0]?.find("Image").length);
      await page.waitForTimeout(400);
      const stages = await page.evaluate(() => window.Konva.stages.length);
      assert.equal(stages, 1, "only the selected photo owns a canvas");
      assert.ok(fullRequests.size <= 3, "only current/adjacent full-size photos load");
      assert.equal(await page.locator(".annotation-photo-thumbnail img").first().getAttribute("src"), photos[0].thumbnail_url);
      const point = async (selector, anchor = false) => page.evaluate(({ selector, anchor }) => {
        const stage = window.Konva.stages.find(stage => stage.container().offsetWidth);
        const node = stage.findOne(selector);
        const position = node.getAbsolutePosition();
        const bounds = stage.container().getBoundingClientRect();
        return { x: bounds.x + position.x + (anchor ? 0 : node.width() / 2),
          y: bounds.y + position.y + (anchor ? 0 : node.height() / 2) };
      }, { selector, anchor });
      await page.locator(".annotation-editor-pane.is-active .annotation-canvas-viewport").scrollIntoViewIfNeeded();
      const center = await point(".annotation-shape");
      await page.mouse.click(center.x, center.y);
      await page.waitForFunction(() => window.Konva.stages.some(stage => stage.findOne("Transformer")?.nodes().length));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => { window.photoDraws = 0; });
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(center.x + 20, center.y + 15, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const dragPhotoDraws = await page.evaluate(() => window.photoDraws);
      assert.equal(dragPhotoDraws, 0, "moving a box never redraws the photo");

      const save = page.getByRole("button", { name: "保存标注", exact: true });
      assert.equal(await save.isEnabled(), true, "drag marks annotations dirty");
      await page.getByRole("button", { name: "下一张照片", exact: true }).click();
      await page.getByRole("button", { name: "上一张照片", exact: true }).click();
      assert.equal(await save.isEnabled(), true, "switching photos retains unsaved edits");
      await save.click();
      await page.waitForFunction(() => {
        const button = document.querySelector(".annotation-save-annotations");
        return button?.disabled && button.textContent.includes("保存标注");
      });
      assert.equal(saves.length, 1);
      assert.equal(saves[0].photo_key, "photo:photo-0");
      assert.equal(saves[0].annotations.length, 100);
      assert.ok(saves[0].annotations[0].bbox.x > 200, "moved coordinates saved");

      {
        await page.locator(".annotation-canvas-viewport").scrollIntoViewIfNeeded();
        await page.mouse.click(...Object.values(await point(".annotation-shape")));
        const anchor = await point(".bottom-right", true);
        await page.evaluate(() => { window.photoDraws = 0; });
        await page.mouse.move(anchor.x, anchor.y);
        await page.mouse.down();
        await page.mouse.move(anchor.x + 12, anchor.y + 10, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.photoDraws), 0, "resizing never redraws the photo");
        await save.click();
        await page.waitForFunction(() => {
          const button = document.querySelector(".annotation-save-annotations");
          return button?.disabled && button.textContent.includes("保存标注");
        });
        assert.ok(saves[1].annotations[0].bbox.width > saves[0].annotations[0].bbox.width);

        await page.getByRole("button", { name: "新增标注", exact: true }).click();
        await page.locator(".annotation-canvas-viewport").scrollIntoViewIfNeeded();
        const bounds = await page.locator(".konvajs-content").boundingBox();
        await page.evaluate(() => { window.photoDraws = 0; });
        await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.65);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.85, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.photoDraws), 0, "drawing never redraws the photo");
        await save.click();
        await page.waitForFunction(() => {
          const button = document.querySelector(".annotation-save-annotations");
          return button?.disabled && button.textContent.includes("保存标注");
        });
        assert.equal(saves[2].annotations.length, 101);
        await page.locator(".annotation-canvas-viewport").scrollIntoViewIfNeeded();
        await page.mouse.click(...Object.values(await point(".annotation-shape")));
        await page.getByRole("button", { name: "删除标注", exact: true }).click();
        await save.click();
        await page.waitForFunction(() => {
          const button = document.querySelector(".annotation-save-annotations");
          return button?.disabled && button.textContent.includes("保存标注");
        });
        assert.equal(saves[3].annotations.length, 100);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

        // The photo layer does not participate in hit testing; empty photo
        // areas must still allow the stage itself to zoom and pan.
        await page.locator(".annotation-canvas-viewport").scrollIntoViewIfNeeded();
        const canvas = await page.locator(".konvajs-content").boundingBox();
        const blank = { x: canvas.x + canvas.width * 0.08, y: canvas.y + canvas.height * 0.92 };
        await page.mouse.move(blank.x, blank.y);
        await page.mouse.wheel(0, -120);
        await page.waitForFunction(() => window.Konva.stages[0].scaleX() > 1);
        const beforePan = await page.evaluate(() => window.Konva.stages[0].x());
        await page.mouse.down();
        await page.mouse.move(blank.x - 10, blank.y - 10, { steps: 5 });
        await page.mouse.up();
        assert.ok(await page.evaluate(() => window.Konva.stages[0].x()) < beforePan, "background still supports panning");
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport: viewport.width, stages, fullPhotoRequests: fullRequests.size, dragPhotoDraws, saves: saves.length }));
    } catch (error) {
      console.error({ url: page.url(), errors, text: await page.locator("body").innerText() });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
