const assert = require("node:assert/strict");

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-flash-model";

const { validateArticleResult, createFallback, constants } = require("../src/gemini");

test("accepts only the expected structured Gemini response", () => {
  assert.deepEqual(validateArticleResult({ title: " Заголовок ", summary: " Переказ " }), {
    title: "Заголовок",
    summary: "Переказ",
  });
  assert.equal(validateArticleResult({ title: "Заголовок" }), null);
  assert.equal(
    validateArticleResult({ title: "Заголовок", summary: "Переказ", extra: true }),
    null
  );
  assert.equal(validateArticleResult({ title: "", summary: "Переказ" }), null);
});

test("fallback strips markup and limits output length", () => {
  const fallback = createFallback(
    "<b>Original</b>",
    `<script>bad()</script>${"Text ".repeat(500)}`
  );
  assert.equal(fallback.title, "Original");
  assert.ok(!fallback.summary.includes("bad()"));
  assert.ok(fallback.summary.length <= 700);
});

test("Gemini safety limits are enabled", () => {
  assert.ok(constants.GEMINI_TIMEOUT_MS > 0);
  assert.ok(constants.GEMINI_MAX_INPUT_CHARS > 0);
  assert.ok(constants.GEMINI_CONCURRENCY > 0);
});
