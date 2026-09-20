import express from "express";
import { randomBytes } from "node:crypto";
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
app.use(express.urlencoded({ extended: false, limit: "8kb" }));

const twoFactorChallenges = new Map();

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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageHeaders(response) {
  return response
    .set("cache-control", "no-store")
    .set("referrer-policy", "no-referrer")
    .set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

function oauthPage(response, { success }) {
  pageHeaders(response)
    .status(success ? 200 : 400)
    .send(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>tbot OAuth</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:12vh auto;padding:0 1.5rem;color:#172033}main{border:1px solid #d8dee9;border-radius:18px;padding:2rem;box-shadow:0 12px 42px #17203312}h1{font-size:1.5rem}p{line-height:1.75}</style>
<main><h1>${success ? "Karotter認証が完了しました" : "Karotter認証に失敗しました"}</h1>
<p>${success ? "tbotはOAuthアクセストークンで通知取得と画像返信を開始します。この画面は閉じて構いません。" : "認証を最初からやり直してください。継続して失敗する場合はRenderのOAuth設定を確認してください。"}</p></main></html>`);
}

function accountLoginPage(response, { error = "", twoFactorKey = "" } = {}) {
  const csrf = oauthSession.createState();
  const twoFactor = Boolean(twoFactorKey);
  return pageHeaders(response).status(error ? 400 : 200).send(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>tbot Karotterログイン</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:9vh auto;padding:0 1.25rem;color:#172033;background:#f5f7fb}main{background:#fff;border:1px solid #d8dee9;border-radius:18px;padding:2rem;box-shadow:0 12px 42px #17203312}h1{font-size:1.45rem;margin-top:0}p{line-height:1.7;color:#526174}.error{color:#b42318;background:#fff1f0;padding:.75rem 1rem;border-radius:10px}label{display:block;font-weight:650;margin:1rem 0 .4rem}input{box-sizing:border-box;width:100%;font:inherit;padding:.75rem .85rem;border:1px solid #bdc7d5;border-radius:10px}button{width:100%;margin-top:1.25rem;padding:.8rem;border:0;border-radius:10px;background:#6d49e7;color:#fff;font:inherit;font-weight:700;cursor:pointer}</style>
<main><h1>${twoFactor ? "2段階認証" : "Karotterにログイン"}</h1>
<p>${twoFactor ? "Karotterに表示された認証コードを入力してください。" : "tbotがKarotter APIへログインします。IDとパスワードはKarotterへの送信にだけ使用し、保存・ログ出力しません。"}</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="${twoFactor ? "/oauth/2fa" : "/oauth/login"}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${twoFactor
    ? `<input type="hidden" name="challenge" value="${escapeHtml(twoFactorKey)}"><label for="code">認証コード</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12">`
    : `<label for="identifier">ユーザー名またはメールアドレス</label><input id="identifier" name="identifier" autocomplete="username" required maxlength="254"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024">`}
<button type="submit">${twoFactor ? "認証して接続" : "ログインして接続"}</button></form></main></html>`);
}

function requireSetup(request, response) {
  if (verifySetupAuthorization(request.get("authorization"), config.oauth.setupSecret)) return true;
  response.set("www-authenticate", 'Basic realm="tbot OAuth setup", charset="UTF-8"');
  response.status(401).send("OAuth setup authentication is required");
  return false;
}

function validFormState(value) {
  const state = oauthSession.readState(value);
  return Boolean(state && Date.now() - state.createdAt <= 10 * 60 * 1_000);
}

app.get("/oauth/start", (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  if (!requireSetup(request, response)) return;
  return accountLoginPage(response);
});

app.get("/oauth/authorize", (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  if (!requireSetup(request, response)) return;
  if (!oauthSession.isConfigured()) {
    return response.status(503).json({ error: "OAuth client ID and redirect URI are not configured" });
  }
  return response.redirect(302, oauthSession.createAuthorizationUrl());
});

app.post("/oauth/login", async (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  if (!requireSetup(request, response)) return;
  if (!validFormState(request.body.csrf)) return accountLoginPage(response, { error: "画面の有効期限が切れました。もう一度入力してください。" });
  try {
    const result = await oauthSession.loginWithPassword({
      identifier: request.body.identifier,
      password: request.body.password,
    });
    request.body.password = "";
    if (result.twoFactorRequired) {
      const key = randomBytes(24).toString("base64url");
      twoFactorChallenges.set(key, { token: result.twoFactorToken, createdAt: Date.now() });
      return accountLoginPage(response, { twoFactorKey: key });
    }
    const connected = await bot.resumeAfterAuthentication();
    return response.redirect(303, `/oauth/complete?status=${connected ? "ok" : "error"}`);
  } catch (error) {
    request.body.password = "";
    logger.warn("karotter_account_login_failed", { error: error.message });
    return accountLoginPage(response, { error: "KarotterのIDまたはパスワードを確認してください。" });
  }
});

app.post("/oauth/2fa", async (request, response) => {
  if (!oauthSession) return response.status(404).json({ error: "OAuth mode is disabled" });
  if (!requireSetup(request, response)) return;
  const challenge = twoFactorChallenges.get(String(request.body.challenge || ""));
  if (!validFormState(request.body.csrf) || !challenge || Date.now() - challenge.createdAt > 10 * 60 * 1_000) {
    return accountLoginPage(response, { error: "認証の有効期限が切れました。最初からやり直してください。" });
  }
  try {
    await oauthSession.completeAccountTwoFactor({ twoFactorToken: challenge.token, code: request.body.code });
    twoFactorChallenges.delete(String(request.body.challenge));
    const connected = await bot.resumeAfterAuthentication();
    return response.redirect(303, `/oauth/complete?status=${connected ? "ok" : "error"}`);
  } catch (error) {
    logger.warn("karotter_account_2fa_failed", { error: error.message });
    return accountLoginPage(response, { twoFactorKey: String(request.body.challenge), error: "認証コードを確認してください。" });
  }
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
