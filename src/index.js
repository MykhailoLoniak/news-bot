const { Telegraf } = require("telegraf");
const { runtimeConfig } = require("./config");
const {
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
  closeDatabase,
} = require("./database");
const { generateArticle } = require("./services/gemini");
const { fetchAllFeeds, fetchOpenGraphImage } = require("./services/rss");
const {
  TELEGRAM_CAPTION_LIMIT,
  formatArticleHtml,
  articleKeyboard,
  mainMenu,
  escapeHtml,
  CommandRateLimiter,
} = require("./services/telegram");
const { logger } = require("./utils/logger");
const { NewsPollingJob } = require("./jobs/news-polling");
const { createHealthServer } = require("./services/health");

const bot = new Telegraf(runtimeConfig.telegramBotToken);
let feedCache = { expiresAt: 0, articles: null, promise: null };
const generationCache = new Map();
const commandRateLimiter = new CommandRateLimiter({
  limit: runtimeConfig.commandRateLimit,
  windowMs: runtimeConfig.commandRateWindowMs,
});
const healthServer = createHealthServer({ port: runtimeConfig.healthPort, logger });

bot.use(async (ctx, next) => {
  const isUserAction = ctx.callbackQuery || ctx.message?.text?.startsWith("/");
  if (!isUserAction || commandRateLimiter.consume(ctx.chat?.id)) return next();
  const message = "Забагато команд. Будь ласка, зачекайте кілька секунд і спробуйте ще раз.";
  if (ctx.callbackQuery) return ctx.answerCbQuery(message, { show_alert: true });
  return ctx.reply(message);
});

async function getCachedFeed() {
  if (feedCache.articles && feedCache.expiresAt > Date.now()) return feedCache.articles;
  if (feedCache.promise) return feedCache.promise;

  logger.info("Fetching RSS feeds");
  feedCache.promise = fetchAllFeeds(runtimeConfig.rssSources)
    .then((articles) => {
      feedCache = {
        articles,
        expiresAt: Date.now() + runtimeConfig.feedCacheTtlMs,
        promise: null,
      };
      return articles;
    })
    .catch((error) => {
      feedCache.promise = null;
      throw error;
    });
  return feedCache.promise;
}

function enrichArticle(article) {
  if (!generationCache.has(article.id)) {
    generationCache.set(
      article.id,
      Promise.all([
        generateArticle(article.title, article.content),
        article.imageUrl ? Promise.resolve(article.imageUrl) : fetchOpenGraphImage(article.link),
      ]).then(([generated, imageUrl]) => ({
        ...article,
        originalTitle: article.title,
        imageUrl,
        ...generated,
      }))
    );
  }
  return generationCache.get(article.id);
}

async function sendArticle(article, chatIds) {
  const delivered = [];
  const html = formatArticleHtml(article);
  const replyMarkup = articleKeyboard(article.link);
  const sendText = (chatId) =>
    bot.telegram.sendMessage(chatId, html, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
      link_preview_options: { is_disabled: true },
    });

  for (const chatId of chatIds) {
    try {
      if (article.imageUrl) {
        if ([...html].length <= TELEGRAM_CAPTION_LIMIT) {
          try {
            await bot.telegram.sendPhoto(chatId, article.imageUrl, {
              caption: html,
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            });
          } catch {
            logger.warn("Telegram photo unavailable; sending text fallback", { chatId });
            await sendText(chatId);
          }
        } else {
          try {
            await bot.telegram.sendPhoto(chatId, article.imageUrl);
          } catch {
            logger.warn("Telegram photo unavailable; sending text only", { chatId });
          }
          await sendText(chatId);
        }
      } else {
        await sendText(chatId);
      }
      delivered.push(chatId);
    } catch (error) {
      logger.error("Telegram delivery failed", { chatId, error });
    }
  }
  return delivered;
}

async function executeNewsCycle() {
  logger.info("Checking for new articles");
  const activeChatIds = getActiveChatIds();
  const feed = await getCachedFeed();
  if (activeChatIds.length === 0) {
    logger.info("No active subscribers");
    return;
  }
  const candidates = feed
    .map((article) => ({ article, stored: findArticle(article) }))
    .filter(({ stored }) => !stored?.processedAt)
    .slice(0, runtimeConfig.maxArticlesPerCycle);

  if (candidates.length === 0) {
    logger.info("No new articles found");
    return;
  }

  logger.info("Processing articles", { count: candidates.length });
  const enrichedArticles = await Promise.all(
    candidates.map(({ article, stored }) =>
      stored ? { ...article, ...stored, content: article.content } : enrichArticle(article)
    )
  );
  for (const article of enrichedArticles) {
    const deliveredChatIds = getDeliveredChatIds(article.id);
    const pendingChatIds = activeChatIds.filter((chatId) => !deliveredChatIds.includes(chatId));
    const delivered = await sendArticle(article, pendingChatIds);
    persistDelivery(article, delivered);
  }
  createBackup();
}

function runNewsCycle() {
  return pollingJob.run();
}

const pollingJob = new NewsPollingJob({
  poll: executeNewsCycle,
  intervalMs: runtimeConfig.rssCheckIntervalMs,
  logger,
});

async function sendLatestArticles(chatId, { skipDelivered = false } = {}) {
  const feed = await getCachedFeed();
  if (feed.length === 0) throw new Error("No RSS articles are currently available");
  const latestArticles = await Promise.all(
    feed.slice(0, runtimeConfig.initialArticlesCount).map((article) => {
      const stored = findArticle(article);
      return stored ? { ...article, ...stored, content: article.content } : enrichArticle(article);
    })
  );
  let deliveredCount = 0;
  let attemptedCount = 0;
  for (const article of latestArticles) {
    if (skipDelivered && hasDelivery(article.id, chatId)) continue;
    attemptedCount += 1;
    const delivered = await sendArticle(article, [chatId]);
    if (delivered.length === 0) continue;

    persistDelivery(article, delivered);
    deliveredCount += 1;
  }
  createBackup();
  return { deliveredCount, attemptedCount };
}

function withUxError(handler) {
  return async (ctx) => {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      await handler(ctx);
    } catch (error) {
      logger.error("Telegram command failed", { error });
      await ctx.reply("Сервіс тимчасово недоступний. Будь ласка, спробуйте ще раз трохи пізніше.");
    }
  };
}

async function showStart(ctx) {
  const { activated } = upsertUser(ctx.chat.id, "uk");
  createBackup();
  await ctx.reply(
    "<b>Вітаю! Я новинний бот.</b>\n\n" +
      "Збираю новини з перевірених RSS-джерел, перекладаю їх українською та надсилаю стислий переказ. " +
      "Скористайтеся меню або командами нижче.",
    { parse_mode: "HTML", reply_markup: mainMenu() }
  );
  if (activated) {
    const result = await sendLatestArticles(ctx.chat.id, { skipDelivered: true });
    if (result.attemptedCount > 0 && result.deliveredCount === 0) {
      throw new Error("Initial Telegram delivery failed");
    }
  }
}

async function showLatest(ctx) {
  if (!getUser(ctx.chat.id)) {
    await ctx.reply("Спочатку виконайте /start, щоб створити профіль.");
    return;
  }
  const result = await sendLatestArticles(ctx.chat.id);
  if (result.deliveredCount === 0) throw new Error("Telegram delivery failed");
}

async function subscribeUser(ctx) {
  const { activated } = upsertUser(ctx.chat.id, "uk");
  createBackup();
  await ctx.reply(activated ? "Підписку активовано ✅" : "Ваша підписка вже активна ✅", {
    reply_markup: mainMenu(),
  });
}

async function unsubscribeUser(ctx) {
  const removed = removeSubscriber(ctx.chat.id);
  await ctx.reply(
    removed ? "Ви відписалися від автоматичних новин 🔕" : "Ваша підписка вже неактивна.",
    {
      reply_markup: mainMenu(),
    }
  );
}

async function showSources(ctx) {
  const lines = runtimeConfig.rssSources.map(
    (source) => `• <b>${escapeHtml(source.name)}</b> — ${escapeHtml(source.language)}`
  );
  await ctx.reply(`<b>Джерела новин</b>\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
    reply_markup: mainMenu(),
  });
}

async function showStatus(ctx) {
  const user = getUser(ctx.chat.id);
  const status = user?.isActive ? "активна ✅" : "неактивна 🔕";
  await ctx.reply(`Стан підписки: ${status}`, { reply_markup: mainMenu() });
}

async function showHelp(ctx) {
  await ctx.reply(
    "<b>Команди</b>\n\n" +
      "/latest — показати останні новини\n" +
      "/subscribe — увімкнути автоматичну розсилку\n" +
      "/unsubscribe — вимкнути розсилку\n" +
      "/sources — показати джерела\n" +
      "/status — стан підписки\n" +
      "/delete_my_data — видалити персональні дані\n" +
      "/help — ця довідка",
    { parse_mode: "HTML", reply_markup: mainMenu() }
  );
}

bot.start(withUxError(showStart));
bot.command("latest", withUxError(showLatest));
bot.command("subscribe", withUxError(subscribeUser));
bot.command("unsubscribe", withUxError(unsubscribeUser));
bot.command("sources", withUxError(showSources));
bot.command("status", withUxError(showStatus));
bot.command("help", withUxError(showHelp));

function removeSubscriber(chatId) {
  const removed = deactivateUser(chatId);
  if (removed) createBackup();
  return removed;
}

bot.command(
  "delete_my_data",
  withUxError(async (ctx) => {
    deleteUser(ctx.chat.id);
    createBackup();
    await ctx.reply("Ваш Telegram chat ID та історію доставок видалено.");
  })
);

bot.action("latest", withUxError(showLatest));
bot.action("subscribe", withUxError(subscribeUser));
bot.action("unsubscribe", withUxError(unsubscribeUser));
bot.action("sources", withUxError(showSources));
bot.action("status", withUxError(showStatus));
bot.action("help", withUxError(showHelp));

bot.catch((error) => {
  logger.error("Unhandled Telegram error", { error });
});

async function start() {
  await bot.launch();
  await healthServer.start();
  await bot.telegram
    .setMyCommands([
      { command: "latest", description: "Останні новини" },
      { command: "subscribe", description: "Увімкнути автоматичну розсилку" },
      { command: "unsubscribe", description: "Вимкнути автоматичну розсилку" },
      { command: "sources", description: "Джерела новин" },
      { command: "status", description: "Стан підписки" },
      { command: "help", description: "Допомога" },
      { command: "delete_my_data", description: "Видалити мої дані" },
    ])
    .catch((error) => logger.error("Failed to update Telegram command list", { error }));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  logger.info("Bot is ready");
  await pollingJob.start();
}

async function shutdown(signal) {
  pollingJob.stop();
  bot.stop(signal);
  await healthServer.stop();
  closeDatabase();
}

if (require.main === module) {
  start().catch((error) => {
    logger.error("Application startup failed", { error });
    process.exitCode = 1;
  });
}

module.exports = { start, shutdown, runNewsCycle, bot };
