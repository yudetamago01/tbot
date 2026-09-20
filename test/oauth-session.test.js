import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OAuthAuthorizationRequiredError,
  OAuthSession,
  verifySetupAuthorization,
} from "../src/oauth-session.js";

function tokenResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function temporaryTokenPath() {
  const directory = await mkdtemp(path.join(tmpdir(), "tbot-oauth-"));
  return { directory, tokenPath: path.join(directory, "oauth.json") };
}

test("setup endpoint authorization uses a separate Basic secret", () => {
  const valid = `Basic ${Buffer.from("tbot:setup-secret").toString("base64")}`;
  const wrongUser = `Basic ${Buffer.from("admin:setup-secret").toString("base64")}`;
  assert.equal(verifySetupAuthorization(valid, "setup-secret"), true);
  assert.equal(verifySetupAuthorization(wrongUser, "setup-secret"), false);
  assert.equal(verifySetupAuthorization(valid, "wrong-secret"), false);
});

test("OAuth authorization uses PKCE and stores tokens after a valid callback", async (context) => {
  const { directory, tokenPath } = await temporaryTokenPath();
  context.after(() => rm(directory, { recursive: true, force: true }));
  let request;
  const session = new OAuthSession({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://tbot.example/oauth/callback",
    tokenPath,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return tokenResponse({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "profile offline_access",
        refresh_token: "refresh-token",
      });
    },
  });

  const authorizationUrl = new URL(session.createAuthorizationUrl());
  assert.equal(authorizationUrl.origin, "https://api.karotter.com");
  assert.equal(authorizationUrl.pathname, "/api/oauth/authorize");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));

  await session.completeAuthorization({
    code: "authorization-code",
    state: authorizationUrl.searchParams.get("state"),
  });

  const form = new URLSearchParams(request.options.body);
  assert.equal(request.url, "https://api.karotter.com/api/oauth/token");
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "authorization-code");
  assert.equal(form.get("client_secret"), "client-secret");
  assert.ok(form.get("code_verifier"));
  assert.equal(await session.getAccessToken(), "access-token");
  assert.equal(session.status().authorized, true);

  const saved = JSON.parse(await readFile(tokenPath, "utf8"));
  assert.equal(saved.refreshToken, "refresh-token");
  assert.equal(saved.clientSecret, undefined);
});

test("a refresh token from Render secrets renews an expired access token", async (context) => {
  const { directory, tokenPath } = await temporaryTokenPath();
  context.after(() => rm(directory, { recursive: true, force: true }));
  let grantType;
  const session = new OAuthSession({
    clientId: "client-id",
    redirectUri: "https://tbot.example/oauth/callback",
    initialRefreshToken: "seed-refresh-token",
    tokenPath,
    fetchImpl: async (_url, options) => {
      grantType = new URLSearchParams(options.body).get("grant_type");
      return tokenResponse({ access_token: "renewed-token", expires_in: 1800 });
    },
  });

  assert.equal(await session.getAccessToken(), "renewed-token");
  assert.equal(grantType, "refresh_token");
});

test("OAuth callback rejects a mismatched state without contacting Karotter", async () => {
  let requested = false;
  const session = new OAuthSession({
    clientId: "client-id",
    redirectUri: "https://tbot.example/oauth/callback",
    stateSecret: "state-secret",
    fetchImpl: async () => {
      requested = true;
      return tokenResponse({});
    },
  });
  session.createAuthorizationUrl();
  await assert.rejects(
    () => session.completeAuthorization({ code: "code", state: "wrong-state" }),
    OAuthAuthorizationRequiredError,
  );
  assert.equal(requested, false);
});

test("OAuth callback survives a server restart and concurrent authorization starts", async () => {
  const { directory, tokenPath } = await temporaryTokenPath();
  const stateSecret = "stable-render-secret";
  const firstProcess = new OAuthSession({
    clientId: "client-id",
    redirectUri: "https://tbot.example/oauth/callback",
    stateSecret,
    tokenPath,
  });
  const firstAuthorization = new URL(firstProcess.createAuthorizationUrl());
  firstProcess.createAuthorizationUrl();

  const restartedProcess = new OAuthSession({
    clientId: "client-id",
    redirectUri: "https://tbot.example/oauth/callback",
    stateSecret,
    tokenPath,
    fetchImpl: async () => tokenResponse({ access_token: "access-after-restart", expires_in: 3600 }),
  });

  await restartedProcess.completeAuthorization({
    code: "authorization-code",
    state: firstAuthorization.searchParams.get("state"),
  });
  assert.equal(await restartedProcess.getAccessToken(), "access-after-restart");
  await rm(directory, { recursive: true, force: true });
});
