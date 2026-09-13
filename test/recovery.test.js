const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("restores a corrupt SQLite database from its backup", () => {
  const dbPath = `/tmp/news-bot-recovery-test-${process.pid}.sqlite`;
  const resultPath = `${dbPath}.result`;
  const projectRoot = path.join(__dirname, "..");
  const run = (script) => {
    const childEnv = { ...process.env, NEWS_BOT_DB_PATH: dbPath };
    delete childEnv.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ["-e", script], {
      cwd: projectRoot,
      env: childEnv,
      encoding: "utf8",
    });
  };

  const setup = run(`
    const db = require("./src/db");
    db.upsertUser(777);
    db.createBackup();
    db.closeDatabase();
  `);
  assert.equal(setup.status, 0, setup.stderr);
  fs.writeFileSync(dbPath, "not a sqlite database", { mode: 0o600 });

  const recovery = run(`
    const fs = require("node:fs");
    const db = require("./src/db");
    fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(db.getActiveChatIds()));
    db.closeDatabase();
  `);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(fs.readFileSync(resultPath, "utf8"), "[777]");

  for (const name of fs.readdirSync("/tmp")) {
    if (name.startsWith(path.basename(dbPath))) {
      fs.rmSync(path.join("/tmp", name), { force: true });
    }
  }
});
