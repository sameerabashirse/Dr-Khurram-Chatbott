const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const includedExtensions = new Set([".html", ".css", ".js"]);
const excludedDirectories = new Set(["node_modules", ".git", "tests", "scripts"]);
const placeholderPattern = /\b(lorem ipsum|john doe|jane doe|example clinic|dummy patient)\b/i;
const findings = [];

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(fullPath);
    else if (entry.isFile() && includedExtensions.has(path.extname(entry.name))) {
      fs.readFileSync(fullPath, "utf8").split(/\r?\n/).forEach((line, index) => {
        if (placeholderPattern.test(line)) findings.push(`${path.relative(root, fullPath)}:${index + 1}`);
      });
    }
  }
}

scan(root);
if (findings.length) {
  console.error(`Potential dummy content found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("No known dummy-content markers found.");
