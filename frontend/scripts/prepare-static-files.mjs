import { chmod, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The shell may use umask 0007; Nginx runs as a different user and must be
// able to read the public build output. Limit this to dist, never source/.env.
async function prepareDirectory(directory) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await prepareDirectory(path);
    else if (entry.isFile()) await chmod(path, 0o644);
  }
}

await prepareDirectory(fileURLToPath(new URL("../dist", import.meta.url)));
