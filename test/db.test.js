const assert = require("node:assert/strict");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const testDbPath = `/tmp/news-bot-db-test-${process.pid}.sqlite`;
process.env.NEWS_BOT_DB_PATH = testDbPath;

const db = require("../src/db");

afterAll(() => {
  db.closeDatabase();
  for (const suffix of ["", "-wal", "-shm", ".backup", ".backup.tmp"]) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
});

test("initializes the versioned SQLite schema and indexes", () => {
  const inspector = new DatabaseSync(testDbPath, { readOnly: true });
  const tables = inspector
    .prepare(
      `
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `
    )
    .all()
    .map((row) => row.name);
  const indexes = inspector
    .prepare(
      `
    SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'
  `
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["article_deliveries", "articles", "users"]);
  assert.ok(indexes.includes("idx_articles_guid"));
  assert.ok(indexes.includes("idx_articles_url"));
  assert.ok(indexes.includes("idx_articles_published_at"));
  assert.equal(inspector.prepare("PRAGMA user_version").get().user_version, 1);
  inspector.close();
});

test("stores users independently and records successful article delivery", () => {
  assert.deepEqual(db.upsertUser(100), { created: true, activated: true });
  assert.deepEqual(db.upsertUser(200), { created: true, activated: true });
  assert.deepEqual(db.upsertUser(100), { created: false, activated: false });
  assert.deepEqual(db.getActiveChatIds(), [100, 200]);
  assert.equal(db.deactivateUser(100), true);
  assert.deepEqual(db.getActiveChatIds(), [200]);

  const article = {
    id: "article-1",
    guid: "guid-1",
    source: "https://example.com/feed",
    originalTitle: "Original",
    title: "Переклад",
    summary: "Переказ",
    link: "https://example.com/article",
    imageUrl: null,
    pubDate: "2026-02-01T00:00:00.000Z",
  };
  db.persistDelivery(article, [200]);
  assert.equal(db.hasDelivery("article-1", 200), true);
  assert.equal(db.findArticle(article).processedAt !== null, true);
  assert.equal(db.getLastProcessedDate(), "2026-02-01T00:00:00.000Z");
});

test("enforces unique URL and cascades deleted user deliveries", () => {
  db.persistDelivery(
    {
      id: "different-id",
      guid: "different-guid",
      source: "https://example.com/feed",
      originalTitle: "Same URL",
      title: "Та сама URL",
      summary: "Переказ",
      link: "https://example.com/article",
      pubDate: "2026-02-01T00:00:00.000Z",
    },
    [200]
  );
  const inspector = new DatabaseSync(testDbPath);
  assert.equal(inspector.prepare("SELECT COUNT(*) AS count FROM articles").get().count, 1);
  assert.equal(db.deleteUser(200), true);
  assert.equal(
    inspector.prepare("SELECT COUNT(*) AS count FROM article_deliveries").get().count,
    0
  );
  inspector.close();

  db.createBackup();
  assert.equal(fs.existsSync(db.paths.BACKUP_PATH), true);
});
