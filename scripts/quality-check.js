const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mode = process.argv[2];
const trackedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

if (mode === "secrets") {
  const files = trackedFiles.filter((file) => /(^|\/)(\.env\.example|[^/]+\.(js|json|md|ya?ml))$/i.test(file));
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /^SMTP_PASSWORD=\S+/m,
    /^EMAIL_APPOINTMENT_ALERT_TO=\S+/m,
    /^EMAIL_FROM_ADDRESS=\S+/m
  ];
  const findings = files.flatMap((file) => forbidden.some((pattern) => pattern.test(read(file))) ? [file] : []);
  if (findings.length) throw new Error(`Potential secret found in: ${findings.join(", ")}`);
  console.log("Secret scan passed for tracked project files.");
} else if (mode === "dummy") {
  const emailFiles = trackedFiles.filter((file) => /^src\/services\/(emailTransport|ownerAppointmentEmailService|ownerEmailOutboxService)\.js$/.test(file));
  const forbidden = [/Ayesha Khan/, /NMC-250725-0010/, /owner@example\.com/, /localhost/i];
  const findings = emailFiles.flatMap((file) => forbidden.some((pattern) => pattern.test(read(file))) ? [file] : []);
  if (findings.length) throw new Error(`Dummy email content found in production code: ${findings.join(", ")}`);
  console.log("Dummy-content scan passed for owner email production code.");
} else {
  throw new Error("Use quality-check.js with either secrets or dummy.");
}
