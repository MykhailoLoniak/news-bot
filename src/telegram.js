const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_MESSAGE_LIMIT = 4096;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateText(value, maxLength) {
  const characters = [...String(value ?? "")];
  if (characters.length <= maxLength) return characters.join("");
  return `${characters
    .slice(0, Math.max(0, maxLength - 1))
    .join("")
    .trimEnd()}…`;
}

function formatPublishedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "Дата невідома";
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function formatArticleHtml(article, limit = TELEGRAM_MESSAGE_LIMIT) {
  const title = truncateText(article.title || "Без заголовка", 300);
  const source = truncateText(article.source || "Невідоме джерело", 150);
  const date = formatPublishedDate(article.pubDate);
  let summary = String(article.summary || "Опис відсутній.").trim();

  const render = () =>
    [
      `<b>${escapeHtml(title)}</b>`,
      escapeHtml(summary),
      `<b>Джерело:</b> ${escapeHtml(source)}`,
      `<b>Дата:</b> ${escapeHtml(date)}`,
    ].join("\n\n");

  let html = render();
  while ([...html].length > limit && summary.length > 1) {
    const overflow = [...html].length - limit;
    summary = truncateText(summary, Math.max(1, [...summary].length - overflow - 1));
    html = render();
  }
  return html;
}

function articleKeyboard(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return { inline_keyboard: [[{ text: "Читати повністю", url: parsed.toString() }]] };
  } catch {
    return undefined;
  }
}

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "📰 Останні новини", callback_data: "latest" }],
      [
        { text: "✅ Підписатися", callback_data: "subscribe" },
        { text: "🔕 Відписатися", callback_data: "unsubscribe" },
      ],
      [
        { text: "📡 Джерела", callback_data: "sources" },
        { text: "👤 Стан підписки", callback_data: "status" },
      ],
      [{ text: "❓ Допомога", callback_data: "help" }],
    ],
  };
}

class CommandRateLimiter {
  constructor({ limit = 6, windowMs = 10_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  consume(chatId, now = Date.now()) {
    if (chatId === undefined || chatId === null) return true;
    const recent = (this.requests.get(chatId) || []).filter(
      (timestamp) => now - timestamp < this.windowMs
    );
    if (recent.length >= this.limit) {
      this.requests.set(chatId, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(chatId, recent);
    return true;
  }
}

module.exports = {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  formatPublishedDate,
  formatArticleHtml,
  articleKeyboard,
  mainMenu,
  CommandRateLimiter,
};
