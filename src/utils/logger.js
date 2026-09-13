const levels = { debug: 10, info: 20, warn: 30, error: 40 };

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name || "Error",
    code: error.code,
    status: Number.isInteger(error.status) ? error.status : undefined,
    message: error.publicMessage || error.message || "Unknown error",
  };
}

function createLogger({
  level = "info",
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  const threshold = levels[level] || levels.info;
  const write = (severity, message, context = {}) => {
    if (levels[severity] < threshold) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level: severity,
      message,
      ...context,
    };
    if (payload.error instanceof Error) payload.error = serializeError(payload.error);
    const stream = severity === "error" ? errorOutput : output;
    stream.write(`${JSON.stringify(payload)}\n`);
  };
  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

const logger = createLogger({ level: process.env.LOG_LEVEL });

module.exports = { createLogger, serializeError, logger };
