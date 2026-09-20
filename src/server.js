import express from "express";
import { BotService } from "./bot-service.js";
import { loadConfig } from "./config.js";
import { KarotterClient } from "./karotter-client.js";
import { logger } from "./logger.js";
import { renderImage } from "./renderer.js";
import { StateStore } from "./state-store.js";

const config = loadConfig();
const client = new KarotterClient({
  apiKey: config.apiKey,
  authMode: config.authMode,
  baseUrl: config.baseUrl,
  timeoutMs: config.httpTimeoutMs,
  requestsPerMinute: config.requestsPerMinute,
});
const stateStore = new StateStore(config.statePath, logger);
const bot = new BotService({
  client,
  renderer: renderImage,
  stateStore,
  config,
  log: logger,
});

const app = express();
app.disable("x-powered-by");

app.get("/", (_request, response) => {
  response.json({
    service: "karotter-tbot",
    version: "1.0.0",
    status: "running",
    username: `@${config.username}`,
    docs: "https://karotter.com/api-docs",
  });
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) });
});

app.get("/ready", (_request, response) => {
  const health = bot.health();
  response.status(health.ok ? 200 : 503).json(health);
});

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info("server_listening", { port: config.port, polling: config.enablePolling });
  bot.start().catch((error) => {
    logger.error("bot_start_failed", { error: error.message });
  });
});

function shutdown(signal) {
  logger.info("shutdown_started", { signal });
  bot.stop();
  server.close((error) => {
    if (error) {
      logger.error("shutdown_failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  logger.error("unhandled_rejection", { error: error?.message || String(error) });
});
process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error: error.message });
  process.exitCode = 1;
  shutdown("uncaughtException");
});
