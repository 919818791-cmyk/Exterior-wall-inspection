import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDirectory } from "./prepare-static-files.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const staging = await mkdtemp(join(root, ".static-build-"));

try {
  const result = spawnSync(process.execPath, [
    join(root, "node_modules/vite/bin/vite.js"), "build", "--outDir", staging
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Vite build failed (${result.status})`);
  await prepareDirectory(staging);
  // Security releases can retire old bundles containing map credentials.
  const currentAssets = new Set(await readdir(join(staging, "assets")));

  await mkdir(dist, { recursive: true, mode: 0o755 });
  // Keep hashed assets from earlier releases for tabs that still use them.
  // Publish every dependency before atomically replacing the HTML entry point.
  for (const entry of await readdir(staging)) {
    if (entry === "index.html") continue;
    await cp(join(staging, entry), join(dist, entry), { recursive: true });
  }
  await prepareDirectory(dist);
  await rename(join(staging, "index.html"), join(dist, "index.html"));
  if (process.env.RETIRE_OLD_JS_ASSETS === "1") {
    for (const asset of await readdir(join(dist, "assets"))) {
      if (/\.(?:js|map)$/.test(asset) && !currentAssets.has(asset)) {
        await rm(join(dist, "assets", asset));
      }
    }
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
