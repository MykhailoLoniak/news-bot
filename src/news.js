const crypto = require("crypto");

function canonicalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|igshid$|maca$|xtor$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return String(rawUrl).trim();
  }
}

function getArticleId(article) {
  const stableSource =
    article.guid?.trim() ||
    canonicalizeUrl(article.link) ||
    `${article.title || ""}|${article.pubDate || ""}`;
  return crypto.createHash("sha256").update(stableSource).digest("hex");
}

function deduplicateArticles(articles) {
  const unique = new Map();
  const seenGuids = new Set();
  const seenUrls = new Set();
  for (const article of articles) {
    const guid = article.guid?.trim();
    const url = canonicalizeUrl(article.link);
    if ((guid && seenGuids.has(guid)) || (url && seenUrls.has(url))) continue;
    const id = getArticleId(article);
    if (!unique.has(id)) {
      unique.set(id, { ...article, link: url || article.link, id });
      if (guid) seenGuids.add(guid);
      if (url) seenUrls.add(url);
    }
  }
  return [...unique.values()];
}

module.exports = {
  canonicalizeUrl,
  getArticleId,
  deduplicateArticles,
};
