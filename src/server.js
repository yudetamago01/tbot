import express from "express";
import { BotService } from "./bot-service.js";
import { loadConfig } from "./config.js";
import { KarotterClient } from "./karotter-client.js";
import { logger } from "./logger.js";
import { OAuthSession, verifySetupAuthorization } from "./oauth-session.js";
import { renderImage } from "./renderer.js";
import { StateStore } from "./state-store.js";

const config = loadConfig();
const oauthSession = config.authMode === "oauth"
  ? new OAuthSession({
      ...config.oauth,
      initialRefreshToken: config.oauth.refreshToken,
      stateSecret: config.oauth.setupSecret,
      timeoutMs: config.httpTimeoutMs,
      log: logger,
    })
  : null;
await oauthSession?.load();
const client = new KarotterClient({
  apiKey: config.apiKey,
  authMode: config.authMode,
  baseUrl: config.baseUrl,
  timeoutMs: config.httpTimeoutMs,
  requestsPerMinute: config.requestsPerMinute,
  tokenProvider: oauthSession ? () => oauthSession.getAccessToken() : undefined,
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
    authMode: config.authMode,
    oauth: oauthSession?.status() || null,
    authorize: oauthSession ? "/oauth/start" : null,
    docs: "https://karotter.com/api-docs",
  });
});

function oauthPage(response, { success }) {
  response
    .set("cache-control", "no-store")
    .set("referrer-policy", "no-referrer")
    .set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
    .status(success ? 200 : 400)
    .send(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>tbot OAuth</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:12vh auto;padding:0 1.5rem;color:#172033}main{border:1px solid #d8dee9;border-radius:18px;padding:2rem;box-shadow:0 12px 42px #17203312}h1{font-size:1.5rem}p{line-height:1.75}</style>
<main><h1>${success ? "Karotter認証が完了しました" : "Karotter認証に失敗しました"}</h1>
<p>${success ? "tbotはOAuthアクセストークンで通知取得と画像返信を開始します。この画面は閉じて構いません。" : "認証を最初からやり直してください。継続して失敗する場合はRenderのOAuth設定を確認してください。"}</p></main></html>`);
}

app.get("/oauth/start", (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  if (!verifySetupAuthorization(request.get("authorization"), config.oauth.setupSecret)) {
    response.set("www-authenticate", 'Basic realm="tbot OAuth setup", charset="UTF-8"');
    return response.status(401).send("OAuth setup authentication is required");
  }
  if (!oauthSession.isConfigured()) {
    return response.status(503).json({ error: "OAuth client ID and redirect URI are not configured" });
  }
  return response.redirect(302, oauthSession.createAuthorizationUrl());
});

app.get("/oauth/callback", async (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  try {
    await oauthSession.completeAuthorization({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
    });
    const connected = await bot.resumeAfterAuthentication();
    return response.redirect(303, `/oauth/complete?status=${connected ? "ok" : "error"}`);
  } catch (error) {
    logger.warn("oauth_callback_failed", { error: error.message });
    return response.redirect(303, "/oauth/complete?status=error");
  }
});

app.get("/oauth/complete", (request, response) => {
  return oauthPage(response, { success: request.query.status === "ok" });
});

app.get("/oauth/status", (_request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  return response.json(oauthSession.status());
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
