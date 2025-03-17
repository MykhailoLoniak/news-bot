const Parser = require("rss-parser");
const axios = require("axios");
const { Markup, Telegraf } = require("telegraf");
const { RSS_FEEDS, HUGGINGFACE_API_KEY, TELEGRAM_BOT_TOKEN, MISTRAL_API_KEY, TELEGRAM_CHAT_ID } = require("./config");
const { readDB, saveDB } = require("./db");
const fs = require('fs');
const { Mistral } = require('@mistralai/mistralai');

const parser = new Parser();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const client = new Mistral({ apiKey: MISTRAL_API_KEY });

async function translateToUkrainian(text) {
  try {
    console.log("Виконується запит на переклад...");
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-es-uk",
      { inputs: text },
      { headers: { Authorization: `Bearer ${HUGGINGFACE_API_KEY}` } }
    );

    console.log("Отримана відповідь:", response.data);
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error("Порожня відповідь від API");
    }

    return response.data[0]?.translation_text || text;
  } catch (error) {
    console.error("Помилка перекладу:", error.response?.data || error.message);
    return text;
  }
}

async function fetchRSS() {
  console.log("🔄 Завантаження RSS-стрічок...");
  const articles = (await Promise.all(RSS_FEEDS.map(async (url) => {
    try {
      const feed = await parser.parseURL(url);
      console.log(`✅ Завантажено ${feed.items.length} статей з ${url}`);
      return feed.items.map(item => {
        let imageUrl = null;
        const imageUrlMatch = item['content:encoded']?.match(/<img[^>]+src="([^"]+)"/);
        if (imageUrlMatch) {
          imageUrl = imageUrlMatch[1];
        } else if (item?.media?.content?.url) {
          imageUrl = item.media.content.url;
        } else if (item?.link) {
          imageUrl = item.link;
        }
        return {
          title: item.title,
          link: item.link,
          content: item.contentSnippet ?? item.content ?? "Без опису",
          pubDate: new Date(item.pubDate),
          imageUrl: imageUrl,
        };
      });
    } catch (error) {
      console.error(`❌ Помилка завантаження RSS з ${url}:`, error.message);
      return [];
    }
  }))).flat();

  return articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

function extractLinks(html) {
  let links = [];
  let textWithPlaceholders = html.replace(
    /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g,
    (match, url, text) => {
      links.push({ text, url });
      return `[LINK]`;
    }
  );
  return { textWithPlaceholders, links };
}

function restoreLinks(translatedText, links) {
  let index = 0;
  return translatedText.replace(/\[LINK\]/g, () => {
    if (index < links.length) {
      return `${links[index].text} (${links[index].url})`;
    }
    return "";
  });
}

async function processArticleContent(html) {
  const { textWithPlaceholders, links } = extractLinks(html);
  let translated = await translateToUkrainian(textWithPlaceholders);
  return restoreLinks(translated, links);
}



async function checkForNewArticles() {
  console.log("🔎 Перевірка нових статей...");
  const db = readDB();
  const newArticles = await fetchRSS();
  const getLatestPubDate = () => {
    let date = new Date(0);
    newArticles.forEach(e => {
      if (new Date(e.pubDate) > date) {
        date = new Date(e.pubDate);
      }
    });
    return date;
  };

  const lastProcessedDate = db.lastProcessedDate || getLatestPubDate();
  let addedArticles = newArticles.filter(article => new Date(article.pubDate) > new Date(lastProcessedDate));

  if (addedArticles.length > 0) {
    console.log(`📢 Нових статей: ${addedArticles.length}`);
    for (const article of addedArticles) {
      console.log(`📩 Обробка статті: ${article.title}`);

      article.title = await translateToUkrainian(article.title);
      article.summary = await await processArticleContent(article.content);

      console.log(`📩 Статті: ${article}`);

      let messageSent;
      if (article.imageUrl) {
        messageSent = await sendTelegramMessage(
          `📰 *${article.title}*\n\n${article.summary}\n\n[Читати більше](${article.link})`,
          article.imageUrl
        );
      } else {
        messageSent = await sendTelegramMessage(
          `📰 *${article.title}*\n\n${article.summary}\n\n[Читати більше](${article.link})`
        );
      }

      if (messageSent) {
        db.articles.push(article);
        db.lastProcessedDate = article.pubDate;
        console.log(`✅ Стаття надіслана: ${article.title}`);
      } else {
        console.error(`❌ Не вдалося надіслати статтю: ${article.title}`);
      }
    }

    saveDB(db);
    console.log(`💾 Збережено ${addedArticles.length} нових статей у базу`);
  } else {
    console.log("🔍 Нових статей не знайдено");
  }
}

// checkForNewArticles()

async function summarizer(text) {
  console.log("📜 Узагальнення тексту...");
  try {
    const sentences = text.split(". ");
    text = sentences.slice(0, Math.min(sentences.length, 5)).join(". ") + ".";

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/facebook/bart-large-cnn",
      { inputs: text },
      { headers: { Authorization: `Bearer ${HUGGINGFACE_API_KEY}` } }
    );

    const summary = response.data?.[0]?.summary_text;
    return summary ? await translateToUkrainian(summary) : await translateToUkrainian(text);
  } catch (error) {
    console.error("❌ Помилка узагальнення:", error.message);
    return await translateToUkrainian(text.split(".").slice(0, 3).join(".") + "...");
  }
}

let userChatId = 369600113;

async function sendTelegramMessage(message, photo) {
  if (!userChatId) {
    console.error("❌ Не вказано chat_id для надсилання повідомлення");
    return false;
  }

  console.log("✉️ Надсилання повідомлення в Telegram...");
  try {
    if (photo) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        chat_id: userChatId,
        photo: photo,
        caption: message,
        parse_mode: "Markdown",
      });
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: userChatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      });
    }

    return true;
  } catch (error) {
    console.error("❌ Помилка надсилання в Telegram:", error);
    return false;
  }
}

bot.start((ctx) => {
  userChatId = ctx.message.chat.id;
  console.log(`User's chat_id: ${userChatId}`);

  fs.appendFile('userChatIds.txt', userChatId + '\n', (err) => {
    if (err) {
      console.error('Помилка збереження chat_id:', err);
    } else {
      console.log('chat_id збережено:', userChatId);
    }
  });

  ctx.reply(
    'Привіт! Я новинний бот. Я буду надсилати тобі останні новини.',
    Markup.keyboard([
      ["📢 Новини", "📆 Події"],
      ["ℹ Інформація", "❓ Допомога"],
    ])
      .oneTime()
      .resize()
  );
});

bot.hears("📢 Новини", async (ctx) => { await checkForNewArticles() });
bot.hears("📆 Події", (ctx) => ctx.reply("Список подій..."));
bot.hears("ℹ Інформація", (ctx) => ctx.reply("Це бот для новин."));
bot.hears("❓ Допомога", (ctx) => ctx.reply("Список команд: /start, /menu"));

bot.launch();

console.log("🎯 Бот готовий до роботи!");
