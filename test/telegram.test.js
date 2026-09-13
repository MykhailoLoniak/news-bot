const assert = require("node:assert/strict");
const {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  formatPublishedDate,
  formatArticleHtml,
  articleKeyboard,
  mainMenu,
  CommandRateLimiter,
} = require("../src/telegram");

test("escapes Telegram HTML and includes source and normalized date", () => {
  const html = formatArticleHtml({
    title: "A < B & C",
    summary: 'Summary with "quotes"',
    source: "Source & partner",
    pubDate: "2026-09-12T10:00:00.000Z",
  });
  assert.match(html, /A &lt; B &amp; C/);
  assert.match(html, /Source &amp; partner/);
  assert.match(html, /<b>Дата:<\/b>/);
  assert.equal(escapeHtml('<>&"'), "&lt;&gt;&amp;&quot;");
});

test("keeps article text inside Telegram limits", () => {
  const article = {
    title: "Title",
    summary: "<&> ".repeat(3000),
    source: "Source",
    pubDate: "2026-09-12T10:00:00.000Z",
  };
  assert.ok([...formatArticleHtml(article)].length <= TELEGRAM_MESSAGE_LIMIT);
  assert.ok(
    [...formatArticleHtml(article, TELEGRAM_CAPTION_LIMIT)].length <= TELEGRAM_CAPTION_LIMIT
  );
});

test("builds only safe inline URL buttons and a complete menu", () => {
  assert.equal(articleKeyboard("javascript:alert(1)"), undefined);
  assert.equal(
    articleKeyboard("https://example.com/story").inline_keyboard[0][0].text,
    "Читати повністю"
  );
  const callbacks = mainMenu()
    .inline_keyboard.flat()
    .map((button) => button.callback_data);
  assert.deepEqual(callbacks, ["latest", "subscribe", "unsubscribe", "sources", "status", "help"]);
});

test("rate limits commands independently per chat", () => {
  const limiter = new CommandRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.consume(1, 0), true);
  assert.equal(limiter.consume(1, 1), true);
  assert.equal(limiter.consume(1, 2), false);
  assert.equal(limiter.consume(2, 2), true);
  assert.equal(limiter.consume(1, 1001), true);
});

test("uses safe defaults for missing article fields and invalid dates", () => {
  const html = formatArticleHtml({});
  assert.match(html, /Без заголовка/);
  assert.match(html, /Опис відсутній/);
  assert.match(html, /Невідоме джерело/);
  assert.match(html, /Дата невідома/);
  assert.equal(formatPublishedDate(0), "Дата невідома");
  assert.equal(formatPublishedDate("not-a-date"), "Дата невідома");
  assert.equal(escapeHtml(), "");
});

test("rejects malformed buttons and allows both web protocols", () => {
  assert.equal(articleKeyboard("not a url"), undefined);
  assert.match(articleKeyboard("http://example.com").inline_keyboard[0][0].url, /^http:/);
});

test("handles tiny formatting limits and missing chat IDs", () => {
  const html = formatArticleHtml({ title: "Long", summary: "very long summary" }, 1);
  assert.ok(typeof html === "string");

  const limiter = new CommandRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.consume(undefined), true);
  assert.equal(limiter.consume(null), true);
});
