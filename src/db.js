const fs = require("fs");
const DB_PATH = "./src/db.json";

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.warn("⚠️ Файл БД не існує, створюємо новий...");
      return { articles: [] };
    }

    const rawData = fs.readFileSync(DB_PATH, "utf8");
    if (!rawData.trim()) {
      console.warn("⚠️ Файл БД порожній, повертаємо початкові дані...");
      return { articles: [] };
    }

    return JSON.parse(rawData);
  } catch (error) {
    console.error("❌ Помилка читання БД:", error.message);
    return { articles: [] }; // Повертаємо базові значення, щоб уникнути падіння бота
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log("💾 База даних оновлена!");
  } catch (error) {
    console.error("❌ Помилка збереження БД:", error.message);
  }
}

module.exports = { readDB, saveDB };