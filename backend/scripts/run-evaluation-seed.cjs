const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

// Use the running container's mode, not the host's current Compose default.
function entryArguments(mode) {
  if (!["dev", "eval", "test"].includes(mode)) {
    throw new Error("Seeding requires explicit local dev/eval or guarded test mode.");
  }
  return mode === "eval"
    ? [resolve(__dirname, "../dist/scripts/seed-evaluation.js")]
    : [require.resolve("tsx/cli"), resolve(__dirname, "seed-evaluation.ts")];
}
module.exports = { entryArguments };
if (require.main === module) {
  try {
    const result = spawnSync(process.execPath, [...entryArguments(process.env.APP_MODE), ...process.argv.slice(2)], { stdio: "inherit" });
    if (result.error) process.stderr.write("Unable to start the evaluation seed. Check the backend build.\n");
    process.exitCode = result.status ?? 1;
  } catch {
    process.stderr.write("Unable to select the seed runner. Check local APP_MODE and the backend build.\n");
    process.exitCode = 1;
  }
}
