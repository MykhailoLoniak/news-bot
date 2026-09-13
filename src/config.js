require("dotenv").config();

const path = require("node:path");
const { z } = require("zod");

const rssSourceSchema = z.object({
  name: z.string().trim().min(1),
  language: z.string().trim().min(2).max(10),
  url: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "RSS URLs must use HTTP or HTTPS",
    }),
});

const defaultSources = [
  {
    name: "EL PAÍS",
    language: "es",
    url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada",
  },
  {
    name: "Deutsche Welle Español",
    language: "es",
    url: "https://rss.dw.com/rdf/rss-sp-all",
  },
  {
    name: "France 24 Español",
    language: "es",
    url: "https://www.france24.com/es/rss",
  },
];

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1),
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().min(1),
  RSS_SOURCES_JSON: z.string().optional(),
  RSS_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_ARTICLES_PER_CYCLE: z.coerce.number().int().positive().default(10),
  INITIAL_ARTICLES_COUNT: z.coerce.number().int().positive().default(5),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  GEMINI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(6_000),
  GEMINI_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RSS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  RSS_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  HTML_TIMEOUT_MS: z.coerce.number().int().positive().default(7_000),
  HTML_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
  HTTP_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  FEED_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  COMMAND_RATE_LIMIT: z.coerce.number().int().positive().default(6),
  COMMAND_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_PATH: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function parseSources(value) {
  if (!value) return defaultSources;
  try {
    return z.array(rssSourceSchema).min(1).parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("RSS_SOURCES_JSON must contain valid JSON");
    throw error;
  }
}

/**
 * @typedef {object} AppConfig
 * @property {string} telegramBotToken
 * @property {string} geminiApiKey
 * @property {string} geminiModel
 * @property {Array<{name: string, language: string, url: string}>} rssSources
 */

/** @param {NodeJS.ProcessEnv|Record<string, string|undefined>} env */
function createConfig(env = process.env) {
  const parsed = envSchema.parse(env);
  return Object.freeze({
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    geminiApiKey: parsed.GEMINI_API_KEY,
    geminiModel: parsed.GEMINI_MODEL,
    rssSources: parseSources(parsed.RSS_SOURCES_JSON),
    rssCheckIntervalMs: parsed.RSS_CHECK_INTERVAL_MINUTES * 60 * 1000,
    maxArticlesPerCycle: parsed.MAX_ARTICLES_PER_CYCLE,
    initialArticlesCount: parsed.INITIAL_ARTICLES_COUNT,
    geminiTimeoutMs: parsed.GEMINI_TIMEOUT_MS,
    geminiMaxInputChars: parsed.GEMINI_MAX_INPUT_CHARS,
    geminiConcurrency: parsed.GEMINI_CONCURRENCY,
    rssTimeoutMs: parsed.RSS_TIMEOUT_MS,
    rssMaxBytes: parsed.RSS_MAX_BYTES,
    htmlTimeoutMs: parsed.HTML_TIMEOUT_MS,
    htmlMaxBytes: parsed.HTML_MAX_BYTES,
    httpRetryAttempts: parsed.HTTP_RETRY_ATTEMPTS,
    feedCacheTtlMs: parsed.FEED_CACHE_TTL_MS,
    commandRateLimit: parsed.COMMAND_RATE_LIMIT,
    commandRateWindowMs: parsed.COMMAND_RATE_WINDOW_MS,
    healthPort: parsed.HEALTH_PORT,
    databasePath: path.resolve(parsed.DATABASE_PATH || path.join("data", "news-bot.sqlite")),
    logLevel: parsed.LOG_LEVEL,
  });
}

const runtimeConfig = createConfig();

module.exports = {
  createConfig,
  defaultSources,
  rssSourceSchema,
  runtimeConfig,
  TELEGRAM_BOT_TOKEN: runtimeConfig.telegramBotToken,
  GEMINI_API_KEY: runtimeConfig.geminiApiKey,
  GEMINI_MODEL: runtimeConfig.geminiModel,
  RSS_SOURCES: runtimeConfig.rssSources,
  RSS_CHECK_INTERVAL_MINUTES: runtimeConfig.rssCheckIntervalMs / 60_000,
  MAX_ARTICLES_PER_CYCLE: runtimeConfig.maxArticlesPerCycle,
  INITIAL_ARTICLES_COUNT: runtimeConfig.initialArticlesCount,
};
