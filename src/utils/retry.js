class RetryExhaustedError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RetryExhaustedError";
    this.code = "RETRY_EXHAUSTED";
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withRetry(
  operation,
  {
    attempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 8_000,
    factor = 2,
    jitter = 0,
    shouldRetry = () => false,
    sleepFn = sleep,
  } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      const base = Math.min(maxDelayMs, initialDelayMs * factor ** (attempt - 1));
      const randomized = base + base * jitter * (Math.random() * 2 - 1);
      await sleepFn(Math.max(0, Math.round(randomized)));
    }
  }
  throw new RetryExhaustedError("Retry attempts exhausted", { cause: lastError });
}

module.exports = { withRetry, RetryExhaustedError };
