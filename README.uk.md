# News Bot

Багатокористувацький Telegram-бот, який збирає перевірені RSS-новини, створює фактологічні українські перекази через Gemini та надійно доставляє їх підписникам.

Для локального запуску виконайте `nvm use`, `npm ci`, скопіюйте `.env.example` у `.env`, заповніть секрети й запустіть `npm start`. SQLite зберігається в `data/`; для Docker потрібен persistent volume `/app/data`. Запускайте лише один polling-інстанс.

Команди: `/latest`, `/subscribe`, `/unsubscribe`, `/sources`, `/status`, `/help`, `/delete_my_data`.

Free-tier Gemini може використовувати передані RSS-тексти для покращення продуктів Google. Telegram ID до Gemini не передаються.

Повна технічна документація наведена в [README.md](README.md).
