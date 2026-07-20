const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const excluded = new Set(["node_modules", ".git"]);

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

for (const file of javascriptFiles(root)) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
