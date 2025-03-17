require("dotenv").config()

console.log('telegram key', process.env.TELEGRAM_BOT_TOKEN)

module.exports = {
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  RSS_FEEDS: ["https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada"],
  HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
}