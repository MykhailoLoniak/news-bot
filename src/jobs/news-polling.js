class NewsPollingJob {
  constructor({
    poll,
    intervalMs,
    logger,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  }) {
    this.poll = poll;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.timer = null;
    this.running = null;
  }

  run() {
    if (this.running) return this.running;
    this.running = Promise.resolve()
      .then(() => this.poll())
      .catch((error) => this.logger.error("news_poll_failed", { error }))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  start() {
    if (this.timer) return;
    this.timer = this.setIntervalFn(() => this.run(), this.intervalMs);
    return this.run();
  }

  stop() {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
  }
}

module.exports = { NewsPollingJob };
