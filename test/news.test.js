const assert = require("node:assert/strict");
const { canonicalizeUrl, getArticleId, deduplicateArticles } = require("../src/news");

test("deduplicates articles by guid or canonical URL", () => {
  const byGuid = [
    { guid: "same", link: "https://example.com/a" },
    { guid: "same", link: "https://example.com/b" },
  ];
  assert.equal(deduplicateArticles(byGuid).length, 1);

  const canonicalA = getArticleId({ link: "https://example.com/story?utm_source=rss&id=1" });
  const canonicalB = getArticleId({ link: "https://example.com/story?id=1&utm_medium=email#part" });
  assert.equal(canonicalA, canonicalB);
});

test("deduplicates different guids that share a canonical URL", () => {
  assert.equal(
    deduplicateArticles([
      { guid: "one", link: "https://example.com/story?utm_source=a" },
      { guid: "two", link: "https://example.com/story?utm_source=b" },
    ]).length,
    1
  );
});

test("canonicalizes optional and malformed URLs safely", () => {
  assert.equal(canonicalizeUrl(), "");
  assert.equal(canonicalizeUrl("  not a url  "), "not a url");
  assert.equal(
    canonicalizeUrl("https://example.com/story?z=2&fbclid=secret&a=1#comments"),
    "https://example.com/story?a=1&z=2"
  );
});

test("creates stable IDs without a guid or URL and preserves malformed links", () => {
  const article = { title: "Title", pubDate: "2026-09-12", link: " broken " };
  assert.equal(getArticleId(article), getArticleId({ ...article }));
  assert.equal(deduplicateArticles([article])[0].link, "broken");

  const fallback = { title: "Title", pubDate: "2026-09-12" };
  assert.equal(getArticleId(fallback), getArticleId({ ...fallback }));
});

test("keeps distinct articles and does not mutate the input", () => {
  const articles = [
    { guid: " one ", link: "https://example.com/one" },
    { guid: "two", link: "https://example.com/two" },
    { title: "No identifiers", pubDate: "2026-09-12" },
  ];
  const snapshot = structuredClone(articles);
  assert.equal(deduplicateArticles(articles).length, 3);
  assert.deepEqual(articles, snapshot);
});
