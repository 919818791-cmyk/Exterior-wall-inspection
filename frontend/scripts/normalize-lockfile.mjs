import fs from "node:fs";

const lockfilePath = new URL("../package-lock.json", import.meta.url);
const original = fs.readFileSync(lockfilePath, "utf8");
const lockfile = JSON.parse(original);
const checkOnly = process.argv.includes("--check");

function assertNoHttpAddresses(value) {
  if (typeof value === "string" && /https?:\/\//i.test(value)) {
    throw new Error("Lockfile contains an HTTP address. Run npm run lockfile:normalize; direct URL dependencies require review.");
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) assertNoHttpAddresses(child);
  }
}

if (!checkOnly) {
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    throw new Error("Expected an npm v3 lockfile with package entries.");
  }
  // package.json now has a postinstall hook; npm records that fact on the root.
  lockfile.packages[""].hasInstallScript = true;
  for (const [location, metadata] of Object.entries(lockfile.packages)) {
    if (metadata.resolved) {
      // Only registry packages can be resolved by name + pinned version. Reject
      // git, local-file and arbitrary tarball entries rather than losing sources.
      const name = location.split("node_modules/").at(-1);
      const basename = name.split("/").at(-1);
      const url = new URL(metadata.resolved);
      const expectedPath = `/${name}/-/${basename}-${metadata.version}.tgz`;
      if (
        !["http:", "https:"].includes(url.protocol)
        || url.username || url.password || url.search || url.hash
        || !decodeURIComponent(url.pathname).endsWith(expectedPath)
        || !metadata.integrity
      ) {
        throw new Error(`Cannot remove source information for non-registry dependency: ${location}`);
      }
      delete metadata.resolved;
    }
    // Omit optional, display-only metadata from the lockfile. The downloaded
    // packages retain their original license notices and files (same integrity).
    delete metadata.funding;
    if (typeof metadata.license === "string" && /https?:\/\//i.test(metadata.license)) {
      delete metadata.license;
    }
  }
}

assertNoHttpAddresses(lockfile);
if (!checkOnly) {
  const normalized = `${JSON.stringify(lockfile, null, 2)}\n`;
  if (normalized !== original) fs.writeFileSync(lockfilePath, normalized);
}
console.log(checkOnly ? "Lockfile HTTP-address check passed." : "Lockfile normalized; versions and integrity preserved.");
