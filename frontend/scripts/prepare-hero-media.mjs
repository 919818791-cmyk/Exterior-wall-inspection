import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "scripts/hero-media-manifest.json");
const preset = "h264-1080p-30fps-crf23-max4m-v1";
const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");

function transcode(args) {
  const local = join(root, "../.runtime/media-tools/ffmpeg");
  const executable = process.env.FFMPEG_PATH || (existsSync(local) ? local : "ffmpeg");
  const result = spawnSync(executable, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
    stdio: "inherit"
  });
  if (result.error) {
    throw new Error("首页视频需要更新，请安装 FFmpeg 并加入 PATH，或通过 FFMPEG_PATH 指定可执行文件。", { cause: result.error });
  }
  if (result.status !== 0) throw new Error(`首页视频转码失败 (${result.status})`);
}

// Hashes also detect source replacements that retain their original timestamps.
export async function prepareHeroMedia() {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = { preset, videos: {}, poster: {} };
  for (const name of ["N1", "N2"]) {
    const source = join(root, `public/videos/${name}.mp4`);
    const output = join(root, `public/videos/${name}-hero.mp4`);
    const sourceHash = await hash(source);
    const cached = previous.videos?.[name];
    if (previous.preset !== preset || cached?.source !== sourceHash || !existsSync(output) || cached.output !== await hash(output)) {
      console.log(`更新首页视频：${name}.mp4 → ${name}-hero.mp4`);
      const temporary = `${output}.${process.pid}.tmp.mp4`;
      try {
        transcode(["-i", source, "-map", "0:v:0", "-an", "-sn", "-map_metadata", "-1",
          "-vf", "scale=w='min(1920,iw)':h=-2,fps=30", "-c:v", "libx264", "-preset", "medium",
          "-threads", "2", "-crf", "23", "-maxrate", "4M", "-bufsize", "8M", "-pix_fmt", "yuv420p",
          "-movflags", "+faststart", temporary]);
        await rename(temporary, output);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    manifest.videos[name] = { source: sourceHash, output: await hash(output) };
  }

  const poster = join(root, "public/images/optimized/hero-poster.webp");
  const sourceHash = manifest.videos.N1.source;
  if (previous.preset !== preset || previous.poster?.source !== sourceHash || !existsSync(poster) || previous.poster.output !== await hash(poster)) {
    await mkdir(join(root, "public/images/optimized"), { recursive: true });
    const temporary = `${poster}.${process.pid}.tmp.webp`;
    try {
      transcode(["-i", join(root, "public/videos/N1.mp4"), "-map", "0:v:0", "-frames:v", "1",
        "-vf", "scale=w='min(1600,iw)':h=-2", "-c:v", "libwebp", "-quality", "85", temporary]);
      await rename(temporary, poster);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  manifest.poster = { source: sourceHash, output: await hash(poster) };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (serialized !== `${JSON.stringify(previous, null, 2)}\n`) {
    await writeFile(manifestPath, serialized);
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`首页资源版本：${await prepareHeroMedia()}`);
}
