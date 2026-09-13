const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

test("imports the entry point without starting Telegram polling", () => {
  const databasePath = `/tmp/news-bot-smoke-${process.pid}.sqlite`;
  const script =
    'require("./src/index"); require("./src/database").closeDatabase(); process.exit(0)';
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, DATABASE_PATH: databasePath },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /polling|launch|network/i);
  for (const suffix of ["", "-wal", "-shm", ".backup", ".backup.tmp"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
