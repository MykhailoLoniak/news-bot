class ArticlesRepository {
  constructor(database) {
    this.database = database;
  }

  find(article) {
    return this.database.findArticle(article);
  }
  hasDelivery(articleId, chatId) {
    return this.database.hasDelivery(articleId, chatId);
  }
  deliveredChatIds(articleId) {
    return this.database.getDeliveredChatIds(articleId);
  }
  recordDelivery(article, chatIds) {
    return this.database.persistDelivery(article, chatIds);
  }
  lastProcessedDate() {
    return this.database.getLastProcessedDate();
  }
}

module.exports = { ArticlesRepository };
