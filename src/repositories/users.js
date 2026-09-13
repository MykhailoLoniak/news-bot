class UsersRepository {
  constructor(database) {
    this.database = database;
  }

  find(chatId) {
    return this.database.getUser(chatId);
  }
  activeChatIds() {
    return this.database.getActiveChatIds();
  }
  subscribe(chatId, language = "uk") {
    return this.database.upsertUser(chatId, language);
  }
  unsubscribe(chatId) {
    return this.database.deactivateUser(chatId);
  }
  delete(chatId) {
    return this.database.deleteUser(chatId);
  }
}

module.exports = { UsersRepository };
