const assert = require("node:assert/strict");
const { NewsPollingJob } = require("../src/jobs/news-polling");

test("prevents overlapping polling runs and controls its schedule", async () => {
  let resolvePoll;
  let calls = 0;
  let scheduled;
  let cleared;
  const job = new NewsPollingJob({
    poll: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolvePoll = resolve;
      });
    },
    intervalMs: 100,
    logger: { error() {} },
    setIntervalFn: (callback) => {
      scheduled = callback;
      return 42;
    },
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });
  const first = job.start();
  const second = job.run();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolvePoll();
  await first;
  scheduled();
  await Promise.resolve();
  resolvePoll();
  await job.running;
  job.stop();
  assert.equal(cleared, 42);
});

test("classifies polling failures through the logger", async () => {
  const messages = [];
  const job = new NewsPollingJob({
    poll: async () => {
      throw new Error("offline");
    },
    intervalMs: 1,
    logger: { error: (message) => messages.push(message) },
  });
  await job.run();
  assert.deepEqual(messages, ["news_poll_failed"]);
  job.stop();
});
