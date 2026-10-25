const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Test orchestration only. These fakes are NOT HTTPS, Docker or database proof.
function scenario(settings = {}, script = "eval-up.sh") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenscope-startup-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "bin"));
    for (const file of ["eval-up.sh", "eval-seed.sh", "prepare-env.sh"]) {
      fs.copyFileSync(path.join(__dirname, file), path.join(root, "scripts", file));
    }
    fs.writeFileSync(path.join(root, ".env"), [
      "POSTGRES_USER=local", "POSTGRES_PASSWORD=local", "POSTGRES_DB=tokenscope",
      "DATABASE_URL=postgresql://local:local@postgres:5432/tokenscope",
      "JWT_SECRET=local-test-placeholder", "JWT_ISSUER=local", "JWT_AUDIENCE=local",
      "JWT_ACCESS_TTL_SECONDS=3600", "FRONTEND_PORT=5173", "BACKEND_PORT=3000", "",
    ].join("\n"));
    const log = path.join(root, "calls.jsonl");
    for (const command of ["docker", "curl", "openssl", "make"]) {
      fs.writeFileSync(path.join(root, "bin", command), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ command: ${JSON.stringify(command)}, args, mode: process.env.APP_MODE }) + "\\n");
if (${JSON.stringify(command)} === "docker") {
  if (args[0] === "compose" && args[1] === "cp") fs.writeFileSync(args[3], "fake certificate");
  if (args.includes("eval:seed")) process.exit(Number(process.env.FAKE_SEED_EXIT || 0));
}
if (${JSON.stringify(command)} === "curl") {
  fs.writeFileSync(args[args.indexOf("-o") + 1], args.at(-1).endsWith("/health/db") ? '{"status":"healthy"}' : "<!doctype html><html></html>");
  process.stdout.write("200");
}
`, { mode: 0o755 });
    }
    const result = spawnSync("sh", [path.join(root, "scripts", script)], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
        FAKE_LOG: log, SEED: "0", CONFIRM_DATABASE: "", ANCHOR: "", ...settings },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    return { ...result, calls };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("ordinary eval-up does not seed", () => {
  const result = scenario();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("TokenScope is running"));
  assert.ok(!result.calls.some(call => call.args.includes("eval:seed")));
});
test("explicit one-command startup seeds once, after HTTPS readiness", () => {
  const result = scenario({ SEED: "1", CONFIRM_DATABASE: "tokenscope", ANCHOR: "2026-10-02" });
  assert.equal(result.status, 0, result.stderr);
  const seeds = result.calls.filter(call => call.args.includes("eval:seed"));
  assert.equal(seeds.length, 1);
  assert.ok(seeds[0].args.includes("--confirm-database"));
  assert.ok(seeds[0].args.includes("2026-10-02"));
  assert.ok(result.calls.indexOf(seeds[0]) > result.calls.findLastIndex(call => call.command === "curl"));
  assert.ok(!result.calls.some(call => call.mode === "dev"));
  assert.ok(!JSON.stringify(seeds).includes("NODE_ENV"));
});
test("seed failure fails the combined command and suppresses the final ready message", () => {
  const result = scenario({ SEED: "1", CONFIRM_DATABASE: "tokenscope", FAKE_SEED_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stage "seed"/);
  assert.ok(!result.stdout.includes("TokenScope is running"));
});
test("missing confirmation and invalid SEED fail before Docker work", () => {
  for (const settings of [{ SEED: "1" }, { SEED: "unexpected" }]) {
    const result = scenario(settings);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
  }
});
test("standalone seed only execs the existing backend and never puts password values in arguments", () => {
  const secret = "runtime-only-test-value";
  const result = scenario({ CONFIRM_DATABASE: "tokenscope", DEMO_PASSWORD: secret }, "eval-seed.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].args.slice(0, 3), ["compose", "exec", "-T"]);
  assert.ok(result.calls[0].args.includes("DEMO_PASSWORD"));
  assert.ok(!JSON.stringify(result.calls).includes(secret));
});
