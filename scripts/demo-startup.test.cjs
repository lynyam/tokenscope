const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Orchestration fakes, not evidence of Docker networking or real HTTPS.
function scenario(action, settings = {}) {
  // Match demo.sh's `pwd -P`: temporary paths can contain symlinks,
  // such as /var -> /private/var on macOS.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tokenscope demo ")),
  );
  try {
    for (const dir of ["scripts", "bin", "examples/external-demo", ".local/eval"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.copyFileSync(path.join(__dirname, "demo.sh"), path.join(root, "scripts/demo.sh"));
    const secret = "never-log-this-demo-secret";
    if (settings.CONFIG !== "missing") fs.writeFileSync(path.join(root, "examples/external-demo/.env"), "GEMINI_API_KEY=" + secret + "\n", { mode: 0o600 });
    if (settings.CA !== "missing") fs.writeFileSync(path.join(root, ".local/eval/caddy-root.crt"), "test-certificate", { mode: 0o600 });
    const log = path.join(root, "calls.jsonl");
    const state = path.join(root, "state.json");
    if (settings.EXISTING) fs.writeFileSync(state, JSON.stringify({ owner: settings.EXISTING === "own" ? root : "/another/checkout", status: "running healthy" }));
    // Stop Node parsing Docker's forwarded --env-file argument as its own flag.
    fs.writeFileSync(path.join(root, "bin/docker"), `#!${process.execPath} --
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "info") {
  if (args.includes("{{.OSType}}")) process.stdout.write("linux");
  if (args.some(v => v.includes("SecurityOptions"))) process.stdout.write(process.env.ROOTLESS === "1" ? '["rootless"]' : '[]');
  process.exit(0);
}
if (args[0] === "context") { process.stdout.write(process.env.ENDPOINT || "unix:///var/run/docker.sock"); process.exit(0); }
if (args[0] === "container" && args[1] === "inspect") {
  if (!fs.existsSync(process.env.FAKE_STATE)) process.exit(1);
  const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE));
  if (args.includes("--format")) process.stdout.write(args.some(v => v.includes(".Config.Labels")) ? state.owner : state.status);
  process.exit(0);
}
if (args[0] === "image") process.exit(process.env.IMAGE_MISSING === "1" ? 1 : 0);
if (args[0] === "build") process.exit(Number(process.env.BUILD_EXIT || 0));
if (args[0] === "run") {
  if (args.includes("preflight")) process.exit(Number(process.env.PREFLIGHT_EXIT || 0));
  if (args.includes("-d")) {
    if (process.env.START_EXIT === "1") process.exit(1);
    fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify({ owner: process.env.FAKE_ROOT, status: process.env.RUNNING_STATE || "running healthy" }));
  }
  process.exit(0);
}
if (args[0] === "exec") { process.stdout.write("http://127.0.0.1:8080\\n"); process.exit(0); }
if (args[0] === "rm") fs.unlinkSync(process.env.FAKE_STATE);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, "bin/uname"), `#!${process.execPath}\nprocess.stdout.write(process.env.FAKE_OS || "Linux");\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, "bin/date"), `#!${process.execPath}
const fs = require("node:fs");
const file = process.env.FAKE_ROOT + "/clock";
const time = fs.existsSync(file) ? Number(fs.readFileSync(file)) + 61 : 61;
fs.writeFileSync(file, String(time)); process.stdout.write(String(time));
`, { mode: 0o755 });
    const result = spawnSync("sh", [path.join(root, "scripts/demo.sh"), action], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, DOCKER_HOST: "", DOCKER_CONTEXT: "", PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
        FAKE_ROOT: root, FAKE_LOG: log, FAKE_STATE: state, ...settings }
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    assert.ok(!JSON.stringify({ calls, stdout: result.stdout, stderr: result.stderr }).includes(secret));
    assert.ok(calls.every(args => args[0] !== "compose"), "Demo lifecycle must not operate on the TokenScope stack");
    return { ...result, calls, root, exists: fs.existsSync(state) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("build and application tests require neither demo keys nor exported CA", () => {
  for (const action of ["build", "test"]) {
    const result = scenario(action, { CONFIG: "missing", CA: "missing" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.some(args => args[0] === "build"));
    assert.ok(!result.calls.some(args => args.includes("-d") || args.includes("preflight")));
  }
});

test("up preflights trusted HTTPS, then starts only the bounded, explicit demo container", () => {
  const result = scenario("up");
  assert.equal(result.status, 0, result.stderr);
  const preflight = result.calls.find(args => args.includes("preflight"));
  const start = result.calls.find(args => args.includes("-d"));
  assert.ok(preflight);
  assert.ok(start);
  assert.ok(result.calls.indexOf(preflight) < result.calls.indexOf(start));
  for (const args of [preflight, start]) {
    assert.equal(args[args.indexOf("--network") + 1], "host");
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("no-new-privileges:true"));
    assert.ok(args.includes("NODE_EXTRA_CA_CERTS=/run/caddy-root.crt"));
    assert.ok(args.includes("NODE_TLS_REJECT_UNAUTHORIZED=1"));
    assert.ok(args.includes(`type=bind,src=${result.root}/examples/external-demo/.env,dst=/run/demo.env,readonly`));
    assert.ok(args.includes(`type=bind,src=${result.root}/.local/eval/caddy-root.crt,dst=/run/caddy-root.crt,readonly`));
    assert.equal(args.filter(value => value === "--mount").length, 2);
    assert.ok(!args.includes("--privileged") && !args.includes("-p") && !args.includes("--env-file"));
    assert.ok(!args.some(value => value.includes("docker.sock") || value.includes("root.key")));
  }
  assert.equal(start[start.indexOf("--name") + 1], "tokenscope-external-demo");
  assert.ok(start.includes("--restart=no"));
  assert.match(result.stdout, /External demo is ready: http:\/\/127\.0\.0\.1:8080/);
});

test("up builds a missing image but does not silently rebuild an existing image", () => {
  const missing = scenario("up", { IMAGE_MISSING: "1" });
  assert.equal(missing.status, 0, missing.stderr);
  assert.ok(missing.calls.some(args => args[0] === "build"));
  const existing = scenario("up");
  assert.equal(existing.status, 0, existing.stderr);
  assert.ok(!existing.calls.some(args => args[0] === "build"));
});

test("missing configuration or CA prevents provider preflight and container startup", () => {
  for (const settings of [{ CONFIG: "missing" }, { CA: "missing" }]) {
    const result = scenario("up", settings);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(args => args[0] === "run"));
  }
});

test("failed build or HTTPS preflight never starts the persistent demo", () => {
  for (const settings of [{ IMAGE_MISSING: "1", BUILD_EXIT: "1" }, { PREFLIGHT_EXIT: "1" }]) {
    const result = scenario("up", settings);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(args => args.includes("-d")));
    assert.ok(!result.stdout.includes("External demo is ready"));
  }
});

test("start failure, crashed/unhealthy container and readiness timeout never claim success", () => {
  for (const settings of [{ START_EXIT: "1" }, { RUNNING_STATE: "exited unhealthy" }, { RUNNING_STATE: "running unhealthy" }, { RUNNING_STATE: "running starting" }]) {
    const result = scenario("up", settings);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes("External demo is ready"));
  }
});

test("another checkout's same-named container cannot be started, stopped or inspected for logs", () => {
  for (const action of ["up", "down", "logs"]) {
    const result = scenario(action, { EXISTING: "other" });
    assert.notEqual(result.status, 0);
    assert.ok(result.exists);
    assert.ok(!result.calls.some(args => ["stop", "rm", "logs", "run"].includes(args[0])));
  }
});

test("repeat up preserves an existing owned container and asks for an explicit restart", () => {
  const result = scenario("up", { EXISTING: "own" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /make demo-down/);
  assert.ok(result.exists);
  assert.ok(!result.calls.some(args => ["stop", "rm", "run"].includes(args[0])));
});

test("down targets only the owned demo, not images, volumes or core services", () => {
  const result = scenario("down", { EXISTING: "own", CONFIG: "missing", CA: "missing" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.filter(args => ["stop", "rm"].includes(args[0])), [
    ["stop", "--time", "10", "tokenscope-external-demo"], ["rm", "tokenscope-external-demo"]
  ]);
  assert.ok(!result.exists);
});

test("down without a demo is a harmless no-op", () => {
  const result = scenario("down", { CONFIG: "missing", CA: "missing" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.calls.some(args => ["stop", "rm"].includes(args[0])));
});

test("logs targets only the owned demo", () => {
  const result = scenario("logs", { EXISTING: "own" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.at(-1), ["logs", "--follow", "--tail", "100", "tokenscope-external-demo"]);
});

test("unsupported hosts, rootless networking and remote contexts fail explicitly", () => {
  for (const settings of [{ FAKE_OS: "Darwin" }, { ROOTLESS: "1" }, { ENDPOINT: "ssh://remote-host" }, { DOCKER_HOST: "tcp://remote-host:2376" }, { DOCKER_CONTEXT: "remote", DOCKER_HOST: "unix:///var/run/docker.sock", ENDPOINT: "ssh://remote-host" }]) {
    const result = scenario("up", settings);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(args => args[0] === "run"));
  }
});

test("Docker runtime image has narrow inputs and does not install test dependencies", () => {
  const dir = path.resolve(__dirname, "../examples/external-demo");
  const dockerfile = fs.readFileSync(path.join(dir, "Dockerfile"), "utf8");
  const runtime = dockerfile.split("AS runtime")[1];
  assert.ok(runtime);
  assert.ok(!/npm ci|node_modules|COPY\s+\.\s/.test(runtime));
  assert.ok(runtime.includes("USER node"));
  assert.ok(runtime.includes("HEALTHCHECK"));
  const ignore = fs.readFileSync(path.join(dir, ".dockerignore"), "utf8");
  assert.ok(ignore.split("\n").includes("*"));
  assert.ok(!ignore.split("\n").some(line => line.startsWith("!.env")));
});

test("interactive configuration is private, rejects HTTP, and preserves an existing file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo-config-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "examples/external-demo"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "demo-config.sh"), path.join(root, "scripts/demo-config.sh"));
    const script = path.join(root, "scripts/demo-config.sh");
    const config = path.join(root, "examples/external-demo/.env");
    const keys = ["secret-gemini", "secret-chat", "secret-translation"];
    const invalid = spawnSync("bash", [script], { encoding: "utf8", input: ["http://localhost:5173", ...keys, ""].join("\n") });
    assert.notEqual(invalid.status, 0);
    assert.ok(!fs.existsSync(config));
    const valid = spawnSync("bash", [script], { encoding: "utf8", input: ["", ...keys, ""].join("\n") });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(fs.statSync(config).mode & 0o777, 0o600);
    const before = fs.readFileSync(config, "utf8");
    assert.match(before, /LLM_MODEL=gemini-3.5-flash-lite/);
    assert.match(before, /TOKENSCOPE_BASE_URL=https:\/\/localhost:8443/);
    const repeated = spawnSync("bash", [script], { encoding: "utf8", input: "" });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(fs.readFileSync(config, "utf8"), before);
    for (const key of keys) assert.ok(!(valid.stdout + valid.stderr + repeated.stdout + repeated.stderr).includes(key));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
