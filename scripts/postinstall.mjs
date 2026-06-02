// postinstall.mjs – ad-hoc sign native binaries that macOS rejects unsigned
import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function findFiles(dir, name) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(full, name));
      } else if (entry.name === name) {
        results.push(full);
      }
    }
  } catch {
    // permission denied, skip
  }
  return results;
}

const files = findFiles(
  join(root, "node_modules/.pnpm"),
  "rollup.darwin-x64.node"
);

for (const file of files) {
  try {
    execSync(`codesign --force --sign - "${file}"`, { stdio: "ignore" });
    console.log(`✓ signed ${file.replace(root + "/", "")}`);
  } catch {
    // ignore if codesign unavailable
  }
}
