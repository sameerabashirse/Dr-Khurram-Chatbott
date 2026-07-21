const { execFileSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const roots = ["server.js", "script.js", "src", "tests", "scripts"];

function collect(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (statSync(absolutePath).isFile()) return relativePath.endsWith(".js") ? [relativePath] : [];
  return readdirSync(absolutePath).flatMap((name) => collect(path.join(relativePath, name)));
}

const files = roots.flatMap(collect);
for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "pipe" });
}
console.log(`Syntax build check passed for ${files.length} JavaScript files.`);
