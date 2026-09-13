const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    globals: true,
    setupFiles: ["test/setup.js"],
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/news.js", "src/telegram.js", "src/utils/retry.js", "src/jobs/news-polling.js"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
