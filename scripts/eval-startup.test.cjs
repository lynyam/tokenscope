const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const catalogueRelativePath = "examples/external-demo/config/model-prices.json";
const cataloguePath = path.resolve(__dirname, "..", catalogueRelativePath);

// Test orchestration only. These fakes are NOT HTTPS, Docker or database proof.
function scenario(settings = {}, script = "eval-up.sh") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenscope-startup-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "bin"));
    for (const file of ["eval-up.sh", "eval-seed.sh", "prepare-env.sh"]) {
      fs.copyFileSync(path.join(__dirname, file), path.join(root, "scripts", file));
    }
    const copiedCatalogue = path.join(root, catalogueRelativePath);
    fs.mkdirSync(path.dirname(copiedCatalogue), { recursive: true });
    if (settings.FAKE_CATALOGUE !== "missing") {
      if (settings.FAKE_CATALOGUE === "empty") fs.writeFileSync(copiedCatalogue, "");
      else fs.copyFileSync(cataloguePath, copiedCatalogue);
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
  if (args[0] === "compose" && args[1] === "cp") {
    if (args[2].startsWith("frontend:")) fs.writeFileSync(args[3], "fake certificate");
    if (args[2] === ${JSON.stringify(catalogueRelativePath)}) process.exit(Number(process.env.FAKE_PRICING_COPY_EXIT || 0));
  }
  if (args.includes("pricing:load")) {
    const exitCode = Number(process.env.FAKE_PRICING_EXIT || 0);
    if (exitCode) process.stderr.write("MODEL_PRICE_CONFLICT: No prices were changed.\\n");
    else process.stdout.write(JSON.stringify({ inserted: 0, unchanged: 1 }) + "\\n");
    process.exit(exitCode);
  }
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
  assert.ok(!result.calls.some(call => call.args.includes("--name") || call.args.includes("preflight") || call.args.includes("--target")));
});
test("ordinary eval-up loads pricing once after HTTPS readiness in the evaluation backend", () => {
  const result = scenario();
  assert.equal(result.status, 0, result.stderr);
  const copies = result.calls.filter(call => call.args[1] === "cp" && call.args[2] === catalogueRelativePath);
  const loads = result.calls.filter(call => call.args.includes("pricing:load"));
  assert.equal(copies.length, 1);
  assert.equal(loads.length, 1);
  assert.deepEqual(copies[0].args, ["compose", "cp", catalogueRelativePath, "backend:/tmp/tokenscope-external-demo-model-prices.json"]);
  assert.deepEqual(loads[0].args, ["compose", "exec", "-T", "-w", "/opt/tokenscope/backend", "backend", "npm", "run", "pricing:load", "--", "--file", "/tmp/tokenscope-external-demo-model-prices.json"]);
  assert.equal(loads[0].mode, "eval");
  assert.ok(result.calls.indexOf(copies[0]) > result.calls.findLastIndex(call => call.command === "curl"));
  assert.ok(result.calls.indexOf(loads[0]) > result.calls.indexOf(copies[0]));
  assert.ok(result.stdout.indexOf("[pricing]") < result.stdout.indexOf("TokenScope is running"));
  // Startup does not call a provider or fetch a remote price catalogue.
  assert.ok(result.calls.filter(call => call.command === "curl").every(call => call.args.at(-1).startsWith("https://localhost:")));
});
test("explicit one-command startup seeds once, after HTTPS readiness", () => {
  const result = scenario({ SEED: "1", CONFIRM_DATABASE: "tokenscope", ANCHOR: "2026-10-02" });
  assert.equal(result.status, 0, result.stderr);
  const seeds = result.calls.filter(call => call.args.includes("eval:seed"));
  assert.equal(seeds.length, 1);
  assert.ok(seeds[0].args.includes("--confirm-database"));
  assert.ok(seeds[0].args.includes("2026-10-02"));
  assert.ok(result.calls.indexOf(seeds[0]) > result.calls.findLastIndex(call => call.command === "curl"));
  const priceLoads = result.calls.filter(call => call.args.includes("pricing:load"));
  assert.equal(priceLoads.length, 1);
  assert.ok(result.calls.indexOf(seeds[0]) > result.calls.indexOf(priceLoads[0]));
  assert.ok(!result.calls.some(call => call.mode === "dev"));
  assert.ok(!JSON.stringify(seeds).includes("NODE_ENV"));
});
test("pricing conflict fails startup before seeding and suppresses the final ready message", () => {
  const result = scenario({ SEED: "1", CONFIRM_DATABASE: "tokenscope", FAKE_PRICING_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MODEL_PRICE_CONFLICT/);
  assert.match(result.stderr, /stage "pricing"/);
  assert.ok(!result.stdout.includes("TokenScope is running"));
  assert.ok(!result.calls.some(call => call.args.includes("eval:seed")));
});
test("a failed catalogue copy stops before import and seeding", () => {
  const result = scenario({ SEED: "1", CONFIRM_DATABASE: "tokenscope", FAKE_PRICING_COPY_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stage "pricing"/);
  assert.ok(!result.calls.some(call => call.args.includes("pricing:load") || call.args.includes("eval:seed")));
  assert.ok(!result.stdout.includes("TokenScope is running"));
});
test("missing or empty catalogues fail explicitly, never silently skip pricing", () => {
  for (const value of ["missing", "empty"]) {
    const result = scenario({ FAKE_CATALOGUE: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stage "pricing"/);
    assert.match(result.stderr, /missing or empty/);
    assert.ok(!result.calls.some(call => call.args.includes("pricing:load")));
    assert.ok(!result.stdout.includes("TokenScope is running"));
  }
});
test("an unchanged catalogue result still allows successful startup", () => {
  const result = scenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"inserted":0,"unchanged":1/);
  assert.ok(result.stdout.includes("TokenScope is running"));
});
test("the real demo catalogue is pinned and separate from synthetic seed prices", () => {
  const rows = JSON.parse(fs.readFileSync(cataloguePath, "utf8"));
  assert.deepEqual(rows, [{
    provider: "gemini", model: "gemini-3.5-flash-lite",
    effectiveFrom: "2026-10-25T00:00:00.000Z",
    inputUsdPerMillion: "0.300000", outputUsdPerMillion: "2.500000",
    currency: "USD", isSynthetic: false,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  }]);
  for (const relative of ["fixtures/evaluation/model-prices.json", "fixtures/evaluation/analytics-demo/model-prices.json"]) {
    const seedRows = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8"));
    assert.ok(seedRows.every(row => row.provider !== rows[0].provider || row.model !== rows[0].model));
  }
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
