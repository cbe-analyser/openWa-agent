// Scans tracked (or staged) files for likely credentials before committing or publishing.
// Usage: node scripts/check-secrets.mjs [--staged]
// Exits 1 when something suspicious is found. Placeholders in .env.example and test fixtures
// that are obviously fake (e.g. "test-", "example", "xxxx") are allowed.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const staged = process.argv.includes("--staged");
const files = execFileSync(
  "git",
  staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"] : ["ls-files"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/^(package-lock\.json|.*\.(png|jpg|jpeg|gif|ico|svg|woff2?|pdf|docx))$/i.test(f));

const RULES = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["Meta/Facebook access token", /\bEAA[A-Za-z0-9]{60,}/],
  ["OpenWa API key", /\bowa_live_[A-Za-z0-9]{30,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key block", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  [
    "Postgres URL with password",
    /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s]{6,})@(?!localhost|127\.0\.0\.1|postgres:|db:)/,
  ],
  ["Hard-coded 32-byte base64 key", /ENCRYPTION_KEY\s*=\s*["']?[A-Za-z0-9+/]{43}=/],
];
const FAKE = /(example|placeholder|changeme|change-me|dummy|fake|test[-_]|xxxx|<[^>]+>|\$\{)/i;

let findings = 0;
for (const f of files) {
  if (f === ".env" || /^\.env\.(?!example$)/.test(f)) {
    console.error(`✗ ${f}: environment files must not be committed`);
    findings++;
    continue;
  }
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) {
      const m = line.match(re);
      if (m && !FAKE.test(m[0]) && !FAKE.test(line)) {
        console.error(`✗ ${f}:${i + 1}: possible ${name}`);
        findings++;
      }
    }
  });
}
if (findings) {
  console.error(
    `\n${findings} possible secret(s) found. Remove them (and rotate them if they were real) before committing.`,
  );
  process.exit(1);
}
console.log(`✓ No secrets found in ${files.length} ${staged ? "staged" : "tracked"} files.`);
