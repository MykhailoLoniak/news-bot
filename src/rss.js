const cheerio = require("cheerio");
const Parser = require("rss-parser");
const { deduplicateArticles, canonicalizeUrl } = require("./news");
const { logger } = require("./utils/logger");
const { runtimeConfig } = require("./config");

const parser = new Parser();
const RSS_TIMEOUT_MS = runtimeConfig.rssTimeoutMs;
const RSS_MAX_BYTES = runtimeConfig.rssMaxBytes;
const HTML_MAX_BYTES = runtimeConfig.htmlMaxBytes;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function safeHttpUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(String(rawUrl).trim(), baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeHtml(html) {
  const $ = cheerio.load(String(html ?? ""), { xmlMode: false }, false);
  $("script, style, noscript, iframe, object, embed, svg, canvas, template").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
}

function normalizePublishedDate(item, feed) {
  const candidates = [
    item.pubDate,
    item.isoDate,
    item["dc:date"],
    feed.lastBuildDate,
    feed.pubDate,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function mediaValues(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.flatMap(mediaValues) : [value];
}

function extractRssImage(item, articleUrl) {
  const candidates = [];
  if (item.enclosure?.url && (!item.enclosure.type || item.enclosure.type.startsWith("image/"))) {
    candidates.push(item.enclosure.url);
  }
  for (const media of mediaValues(item["media:content"] || item.media?.content)) {
    if (!media.type || media.type.startsWith("image/") || media.medium === "image")
      candidates.push(media.url);
    for (const thumbnail of mediaValues(media["media:thumbnail"] || media.thumbnail)) {
      candidates.push(thumbnail.url);
    }
  }
  for (const thumbnail of mediaValues(item["media:thumbnail"] || item.media?.thumbnail)) {
    candidates.push(thumbnail.url);
  }

  const html = item["content:encoded"] || item.content || "";
  const $ = cheerio.load(String(html), { xmlMode: false }, false);
  candidates.push(
    $('meta[property="og:image"]').attr("content"),
    $("figure img").first().attr("src"),
    $("img").first().attr("src")
  );
  return candidates.map((candidate) => safeHttpUrl(candidate, articleUrl)).find(Boolean) || null;
}

async function readTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchWithRetry(
  url,
  { timeoutMs = RSS_TIMEOUT_MS, attempts = 3, maxBytes = RSS_MAX_BYTES } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
          "User-Agent": "news-bot/1.0",
        },
      });
      if (response.ok) {
        const text = await readTextLimited(response, maxBytes);
        return { text, headers: response.headers, finalUrl: response.url || url };
      }
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
      if (!RETRYABLE_STATUS_CODES.has(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      const temporary =
        error.name === "AbortError" ||
        error instanceof TypeError ||
        /^HTTP (408|429|5\d\d)$/.test(error.message);
      if (!temporary || attempt === attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

async function fetchSource(source) {
  try {
    const response = await fetchWithRetry(source.url, { maxBytes: RSS_MAX_BYTES });
    const feed = await parser.parseString(response.text);
    return feed.items.map((item) => {
      const link = safeHttpUrl(item.link || item.guid);
      return {
        guid: item.guid ? String(item.guid).trim() : null,
        source: source.name,
        sourceLanguage: source.language,
        title: sanitizeHtml(item.title) || "Без заголовка",
        link: link ? canonicalizeUrl(link) : null,
        content: sanitizeHtml(
          item["content:encoded"] || item.content || item.summary || item.contentSnippet
        ),
        pubDate: normalizePublishedDate(item, feed),
        imageUrl: extractRssImage(item, link),
      };
    });
  } catch (error) {
    throw new Error(
      `${source.name}: RSS unavailable (${error.name === "AbortError" ? "timeout" : error.message})`
    );
  }
}

async function fetchAllFeeds(sources) {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const articles = [];
  for (const result of results) {
    if (result.status === "fulfilled") articles.push(...result.value);
    else logger.error("RSS source failed", { error: result.reason });
  }
  return deduplicateArticles(articles).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

async function fetchOpenGraphImage(articleUrl) {
  const safeUrl = safeHttpUrl(articleUrl);
  if (!safeUrl) return null;
  try {
    const response = await fetchWithRetry(safeUrl, {
      timeoutMs: runtimeConfig.htmlTimeoutMs,
      attempts: Math.min(2, runtimeConfig.httpRetryAttempts),
      maxBytes: HTML_MAX_BYTES,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;
    const $ = cheerio.load(response.text);
    const candidate =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content");
    return safeHttpUrl(candidate, safeUrl);
  } catch {
    return null;
  }
}

module.exports = {
  fetchAllFeeds,
  fetchOpenGraphImage,
  sanitizeHtml,
  safeHttpUrl,
  normalizePublishedDate,
  extractRssImage,
  constants: { RSS_TIMEOUT_MS, RSS_MAX_BYTES, HTML_MAX_BYTES },
};
