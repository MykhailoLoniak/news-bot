const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { logger } = require("./utils/logger");

const DB_PATH = path.resolve(
  process.env.DATABASE_PATH ||
    process.env.NEWS_BOT_DB_PATH ||
    path.join(__dirname, "..", "data", "news-bot.sqlite")
);
const DATA_DIR = path.dirname(DB_PATH);
const BACKUP_PATH = `${DB_PATH}.backup`;
const BACKUP_TEMP_PATH = `${BACKUP_PATH}.tmp`;
let database;

function openDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return db;
}

function migrate(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1)
    throw new Error(`Database schema version ${version} is newer than supported version 1`);
  if (version < 1) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE users (
        chat_id INTEGER PRIMARY KEY,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        language TEXT NOT NULL DEFAULT 'uk',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        guid TEXT UNIQUE,
        source TEXT NOT NULL,
        original_title TEXT NOT NULL,
        translated_title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT UNIQUE,
        image_url TEXT,
        published_at TEXT NOT NULL,
        processed_at TEXT
      );
      CREATE TABLE article_deliveries (
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        chat_id INTEGER NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY (article_id, chat_id)
      );
      CREATE INDEX idx_articles_guid ON articles(guid);
      CREATE INDEX idx_articles_url ON articles(url);
      CREATE INDEX idx_articles_published_at ON articles(published_at DESC);
      CREATE INDEX idx_deliveries_chat_id ON article_deliveries(chat_id);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }
}

function assertIntegrity(db) {
  const result = db.prepare("PRAGMA quick_check").get();
  if (result.quick_check !== "ok")
    throw new Error(`SQLite integrity check failed: ${result.quick_check}`);
}

function quarantineCorruptDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${DB_PATH}${suffix}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${DB_PATH}.corrupt-${timestamp}${suffix}`);
  }
}

function isCorruptionError(error) {
  return /integrity check failed|database disk image is malformed|file is not a database|database corruption/i.test(
    error?.message || ""
  );
}

function initializeDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    database = openDatabase(DB_PATH);
    assertIntegrity(database);
    migrate(database);
  } catch (error) {
    try {
      database?.close();
    } catch {}
    database = null;
    if (!isCorruptionError(error)) throw error;
    quarantineCorruptDatabase();
    if (fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(BACKUP_PATH, DB_PATH);
      database = openDatabase(DB_PATH);
      assertIntegrity(database);
      migrate(database);
      logger.warn("SQLite restored from backup; corrupt files were quarantined");
    } else {
      database = openDatabase(DB_PATH);
      migrate(database);
      logger.warn("Corrupt SQLite database quarantined; created a new database");
    }
  }
}

function createBackup() {
  assertIntegrity(database);
  fs.writeFileSync(BACKUP_TEMP_PATH, database.serialize(), { mode: 0o600 });
  fs.renameSync(BACKUP_TEMP_PATH, BACKUP_PATH);
}

function mapArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    guid: row.guid,
    source: row.source,
    title: row.translated_title,
    originalTitle: row.original_title,
    summary: row.summary,
    link: row.url,
    imageUrl: row.image_url,
    pubDate: row.published_at,
    processedAt: row.processed_at,
  };
}

function upsertUser(chatId, language = "uk") {
  const now = new Date().toISOString();
  const existing = database.prepare("SELECT is_active FROM users WHERE chat_id = ?").get(chatId);
  database
    .prepare(
      `
    INSERT INTO users (chat_id, is_active, language, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      is_active = 1, language = excluded.language, updated_at = excluded.updated_at
  `
    )
    .run(chatId, language, now, now);
  return { created: !existing, activated: !existing || existing.is_active === 0 };
}

function deactivateUser(chatId) {
  return (
    database
      .prepare(
        `
    UPDATE users SET is_active = 0, updated_at = ?
    WHERE chat_id = ? AND is_active = 1
  `
      )
      .run(new Date().toISOString(), chatId).changes > 0
  );
}

function deleteUser(chatId) {
  return database.prepare("DELETE FROM users WHERE chat_id = ?").run(chatId).changes > 0;
}

function getActiveChatIds() {
  return database
    .prepare("SELECT chat_id FROM users WHERE is_active = 1 ORDER BY created_at")
    .all()
    .map((row) => row.chat_id);
}

function getUser(chatId) {
  const row = database
    .prepare(
      `
    SELECT chat_id, is_active, language, created_at, updated_at
    FROM users WHERE chat_id = ?
  `
    )
    .get(chatId);
  if (!row) return null;
  return {
    chatId: row.chat_id,
    isActive: row.is_active === 1,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findArticle(article) {
  const clauses = ["id = ?"];
  const params = [article.id];
  if (article.guid) {
    clauses.push("guid = ?");
    params.push(article.guid);
  }
  if (article.link) {
    clauses.push("url = ?");
    params.push(article.link);
  }
  return mapArticle(
    database.prepare(`SELECT * FROM articles WHERE ${clauses.join(" OR ")} LIMIT 1`).get(...params)
  );
}

function hasDelivery(articleId, chatId) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM article_deliveries WHERE article_id = ? AND chat_id = ?")
      .get(articleId, chatId)
  );
}

function getDeliveredChatIds(articleId) {
  return database
    .prepare("SELECT chat_id FROM article_deliveries WHERE article_id = ?")
    .all(articleId)
    .map((row) => row.chat_id);
}

function persistDelivery(article, deliveredChatIds) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = findArticle(article);
    const articleId = existing?.id || article.id;
    database
      .prepare(
        `
      INSERT INTO articles (
        id, guid, source, original_title, translated_title, summary,
        url, image_url, published_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        translated_title = excluded.translated_title,
        summary = excluded.summary,
        image_url = excluded.image_url
    `
      )
      .run(
        articleId,
        article.guid || null,
        article.source,
        article.originalTitle || article.title,
        article.title,
        article.summary,
        article.link || null,
        article.imageUrl || null,
        new Date(article.pubDate).toISOString()
      );

    const insertDelivery = database.prepare(`
      INSERT OR IGNORE INTO article_deliveries (article_id, chat_id, delivered_at)
      VALUES (?, ?, ?)
    `);
    const deliveredAt = new Date().toISOString();
    for (const chatId of deliveredChatIds) insertDelivery.run(articleId, chatId, deliveredAt);

    const pending = database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM users u
      WHERE u.is_active = 1 AND NOT EXISTS (
        SELECT 1 FROM article_deliveries d
        WHERE d.article_id = ? AND d.chat_id = u.chat_id
      )
    `
      )
      .get(articleId).count;
    const activeUsers = database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE is_active = 1")
      .get().count;
    if (activeUsers > 0 && pending === 0) {
      database
        .prepare("UPDATE articles SET processed_at = COALESCE(processed_at, ?) WHERE id = ?")
        .run(new Date().toISOString(), articleId);
    }
    database.exec("COMMIT");
    return articleId;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function getLastProcessedDate() {
  return (
    database
      .prepare("SELECT MAX(published_at) AS value FROM articles WHERE processed_at IS NOT NULL")
      .get().value || null
  );
}

function closeDatabase() {
  if (!database) return;
  createBackup();
  database.close();
  database = null;
}

initializeDatabase();

module.exports = {
  paths: { DB_PATH, BACKUP_PATH },
  createBackup,
  upsertUser,
  deactivateUser,
  deleteUser,
  getActiveChatIds,
  getUser,
  findArticle,
  hasDelivery,
  getDeliveredChatIds,
  persistDelivery,
  getLastProcessedDate,
  closeDatabase,
};
