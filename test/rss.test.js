const assert = require("node:assert/strict");
const {
  fetchAllFeeds,
  fetchOpenGraphImage,
  sanitizeHtml,
  safeHttpUrl,
  normalizePublishedDate,
  extractRssImage,
} = require("../src/rss");

test("sanitizes HTML without regex parsing and validates URL protocols", () => {
  assert.equal(
    sanitizeHtml(
      "<article><style>.x{}</style><script>steal()</script><p>Hello <b>world</b></p></article>"
    ),
    "Hello world"
  );
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/plain,test"), null);
  assert.equal(
    safeHttpUrl("/image.jpg", "https://example.com/story"),
    "https://example.com/image.jpg"
  );
});

test("normalizes valid dates and handles a missing pubDate deterministically", () => {
  assert.equal(normalizePublishedDate({ pubDate: "invalid" }, {}), "1970-01-01T00:00:00.000Z");
  assert.equal(
    normalizePublishedDate({}, { lastBuildDate: "2026-09-12T10:00:00Z" }),
    "2026-09-12T10:00:00.000Z"
  );
});

test("extracts images from enclosure, Media RSS and parsed HTML", () => {
  assert.equal(
    extractRssImage({
      enclosure: { url: "https://example.com/a.jpg", type: "image/jpeg" },
    }),
    "https://example.com/a.jpg"
  );
  assert.equal(
    extractRssImage({
      "media:thumbnail": { url: "https://example.com/b.jpg" },
    }),
    "https://example.com/b.jpg"
  );
  assert.equal(
    extractRssImage(
      {
        content: '<figure><img src="/c.jpg"></figure>',
      },
      "https://example.com/story"
    ),
    "https://example.com/c.jpg"
  );
});

test("retries a temporary feed failure and isolates an unavailable feed", async () => {
  let attempts = 0;
  const originalFetch = global.fetch;
  const base = "https://example.test";
  global.fetch = async (url) => {
    if (url === `${base}/feed`) {
      attempts += 1;
      if (attempts < 3) return new Response("temporary", { status: 503 });
      return new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel>
        <title>Test</title><lastBuildDate>Sat, 12 Sep 2026 10:00:00 GMT</lastBuildDate>
        <item><guid>one</guid><title><![CDATA[<b>Title</b>]]></title>
        <link>${base}/story?utm_source=rss</link>
        <description><![CDATA[<script>bad()</script><p>Clean text</p>]]></description>
        <enclosure url="${base}/image.jpg" type="image/jpeg"/>
        </item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } }
      );
    }
    if (url === `${base}/story`) {
      return new Response('<meta property="og:image" content="/og.jpg">', {
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("missing", { status: 404 });
  };
  onTestFinished(() => {
    global.fetch = originalFetch;
  });

  const articles = await fetchAllFeeds([
    { name: "Working source", language: "en", url: `${base}/feed` },
    { name: "Broken source", language: "en", url: `${base}/missing` },
  ]);
  assert.equal(attempts, 3);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].source, "Working source");
  assert.equal(articles[0].sourceLanguage, "en");
  assert.equal(articles[0].title, "Title");
  assert.equal(articles[0].content, "Clean text");
  assert.equal(articles[0].link, `${base}/story`);
  assert.equal(articles[0].pubDate, "2026-09-12T10:00:00.000Z");
  assert.equal(articles[0].imageUrl, `${base}/image.jpg`);
  assert.equal(await fetchOpenGraphImage(`${base}/story`), `${base}/og.jpg`);
});
