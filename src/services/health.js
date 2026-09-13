const http = require("node:http");

function createHealthServer({ port, logger }) {
  let server;
  return {
    start() {
      if (port === 0 || server) return Promise.resolve();
      server = http.createServer((request, response) => {
        if (request.method === "GET" && request.url === "/health") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end('{"status":"ok"}');
          return;
        }
        response.writeHead(404).end();
      });
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
          server.off("error", reject);
          logger.info("Health endpoint ready", { port });
          resolve();
        });
      });
    },
    stop() {
      if (!server) return Promise.resolve();
      const activeServer = server;
      server = undefined;
      return new Promise((resolve, reject) =>
        activeServer.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

module.exports = { createHealthServer };
