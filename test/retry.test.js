const assert = require("node:assert/strict");
const { withRetry } = require("../src/utils/retry");

test("returns immediately after a successful operation", async () => {
  assert.equal(await withRetry(() => "ok"), "ok");
});

test("uses exponential backoff for controlled temporary errors", async () => {
  let attempts = 0;
  const delays = [];
  const result = await withRetry(
    () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("temporary"), { status: 503 });
      return "recovered";
    },
    {
      attempts: 3,
      initialDelayMs: 10,
      factor: 2,
      shouldRetry: (error) => error.status >= 500,
      sleepFn: async (delay) => delays.push(delay),
    }
  );
  assert.equal(result, "recovered");
  assert.deepEqual(delays, [10, 20]);
});

test("does not retry permanent errors", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      () => {
        attempts += 1;
        throw new Error("permanent");
      },
      { shouldRetry: () => false }
    ),
    /permanent/
  );
  assert.equal(attempts, 1);
});
