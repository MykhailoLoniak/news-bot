const COMMANDS = Object.freeze([
  { command: "latest", description: "Останні новини" },
  { command: "subscribe", description: "Увімкнути автоматичну розсилку" },
  { command: "unsubscribe", description: "Вимкнути автоматичну розсилку" },
  { command: "sources", description: "Джерела новин" },
  { command: "status", description: "Стан підписки" },
  { command: "help", description: "Допомога" },
  { command: "delete_my_data", description: "Видалити мої дані" },
]);

module.exports = { COMMANDS };
