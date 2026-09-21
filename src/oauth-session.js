import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1_000;
const LEGACY_OAUTH_BASE_URL = "https://karotter.com/api/oauth";
const OAUTH_BASE_URL = "https://api.karotter.com/api/oauth";
const ACCOUNT_API_BASE_URL = "https://api.karotter.com/api";

export class OAuthAuthorizationRequiredError extends Error {
  constructor(message = "Karotter OAuth authorization is required") {
    super(message);
    this.name = "OAuthAuthorizationRequiredError";
    this.code = "OAUTH_AUTHORIZATION_REQUIRED";
  }
}

function base64UrlSha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function hmacBase64Url(secret, value) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeOAuthBaseUrl(value) {
  const normalized = String(value || OAUTH_BASE_URL).trim().replace(/\/+$/, "");
  return normalized === LEGACY_OAUTH_BASE_URL ? OAUTH_BASE_URL : normalized;
}

function accessTokenExpiresAt(token, expiresIn) {
  const duration = Number(expiresIn);
  if (Number.isFinite(duration) && duration > 0) return Date.now() + duration * 1_000;
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    if (Number.isFinite(payload?.exp)) return payload.exp * 1_000;
  } catch {
    // Karotter may return an opaque access token instead of a JWT.
  }
  return Date.now() + 15 * 60 * 1_000;
}

export function verifySetupAuthorization(header, setupSecret) {
  if (!setupSecret || !header?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeEqual(username, "tbot") && safeEqual(password, setupSecret);
  } catch {
    return false;
  }
}

export class OAuthSession {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    scope = "profile offline_access",
    // The OAuth session cookie belongs to Karotter's API host. Starting the
    // authorization request on the web host can bounce a signed-in user back
    // to /login indefinitely even though both hosts expose the same route.
    baseUrl = "https://api.karotter.com/api/oauth",
    tokenPath = "./data/oauth.json",
    initialRefreshToken,
    stateSecret,
    accountBaseUrl = ACCOUNT_API_BASE_URL,
    defaultProvider = "oauth",
    timeoutMs = 15_000,
    fetchImpl = fetch,
    log,
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.scope = scope;
    this.baseUrl = normalizeOAuthBaseUrl(baseUrl);
    this.tokenPath = path.resolve(tokenPath);
    this.initialRefreshToken = initialRefreshToken;
    this.stateSecret = stateSecret || clientSecret;
    this.accountBaseUrl = String(accountBaseUrl || ACCOUNT_API_BASE_URL).replace(/\/+$/, "");
    this.defaultProvider = defaultProvider === "account" ? "account" : "oauth";
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.loaded = false;
    this.refreshPromise = null;
    this.tokens = {
      accessToken: null,
      refreshToken: null,
      expiresAt: 0,
      scope: null,
      provider: this.defaultProvider,
      deviceId: randomBytes(16).toString("hex"),
    };
  }

  isConfigured() {
    return Boolean(this.clientId && this.redirectUri);
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.tokenPath, "utf8"));
      this.tokens = {
        accessToken: parsed?.accessToken || null,
        refreshToken: parsed?.refreshToken || null,
        expiresAt: Number(parsed?.expiresAt) || 0,
        scope: parsed?.scope || null,
        provider: parsed?.provider === "account" ? "account" : this.defaultProvider,
        deviceId: parsed?.deviceId || this.tokens.deviceId,
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.log?.warn("oauth_token_load_failed", { error: error.message });
      }
    }
    if (!this.tokens.refreshToken && this.initialRefreshToken) {
      this.tokens.refreshToken = this.initialRefreshToken;
    }
  }

  status() {
    return {
      mode: this.tokens.provider === "account" ? "account" : "oauth",
      configured: this.isConfigured() || Boolean(this.stateSecret),
      authorized: Boolean(this.tokens.accessToken || this.tokens.refreshToken),
      expiresAt: this.tokens.expiresAt ? new Date(this.tokens.expiresAt).toISOString() : null,
      scope: this.tokens.scope,
    };
  }

  getDeviceId() {
    return this.tokens.deviceId;
  }

  createAuthorizationUrl() {
    if (!this.isConfigured()) {
      throw new OAuthAuthorizationRequiredError("OAuth client ID and redirect URI are not configured");
    }
    if (!this.stateSecret) {
      throw new OAuthAuthorizationRequiredError("OAuth state secret is not configured");
    }
    const state = this.createState();
    const verifier = this.verifierForState(state.split(".")[0]);
    const url = new URL(`${this.baseUrl}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", this.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", base64UrlSha256(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async completeAuthorization({ code, state, error }) {
    if (error) throw new OAuthAuthorizationRequiredError(`Karotter authorization failed: ${error}`);
    const pending = this.readState(state);
    if (!pending) {
      throw new OAuthAuthorizationRequiredError("OAuth state did not match; start authorization again");
    }
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      throw new OAuthAuthorizationRequiredError("OAuth authorization expired; start again");
    }
    if (!code) throw new OAuthAuthorizationRequiredError("OAuth authorization code is missing");
    return this.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret || undefined,
      code_verifier: pending.verifier,
    });
  }

  createState() {
    const issuedAt = Buffer.alloc(8);
    issuedAt.writeBigUInt64BE(BigInt(Date.now()));
    const nonce = Buffer.concat([issuedAt, randomBytes(16)]).toString("base64url");
    const signature = hmacBase64Url(this.stateSecret, `tbot-oauth-state\0${nonce}`);
    return `${nonce}.${signature}`;
  }

  readState(value) {
    if (!value || !this.stateSecret) return null;
    try {
      const [nonce, signature] = String(value).split(".");
      if (!nonce || !signature || !safeEqual(signature, hmacBase64Url(this.stateSecret, `tbot-oauth-state\0${nonce}`))) {
        return null;
      }
      const nonceBytes = Buffer.from(nonce, "base64url");
      if (nonceBytes.length !== 24) return null;
      const createdAt = Number(nonceBytes.readBigUInt64BE(0));
      return { createdAt, verifier: this.verifierForState(nonce) };
    } catch {
      return null;
    }
  }

  verifierForState(state) {
    return hmacBase64Url(this.stateSecret, `tbot-oauth-pkce\0${state}`);
  }

  async getAccessToken() {
    await this.load();
    if (this.tokens.accessToken && Date.now() < this.tokens.expiresAt - 60_000) {
      return this.tokens.accessToken;
    }
    if (!this.tokens.refreshToken) throw new OAuthAuthorizationRequiredError();
    if (!this.refreshPromise) {
      this.refreshPromise = (this.tokens.provider === "account"
        ? this.refreshAccountToken()
        : this.exchangeToken({
            grant_type: "refresh_token",
            refresh_token: this.tokens.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret || undefined,
          })
      ).finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
    return this.tokens.accessToken;
  }

  async exchangeToken(values) {
    if (!this.isConfigured()) throw new OAuthAuthorizationRequiredError("OAuth is not configured");
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value != null && value !== "") form.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.access_token) {
        throw new OAuthAuthorizationRequiredError(
          body?.error_description || body?.error || `OAuth token exchange returned ${response.status}`,
        );
      }
      const expiresIn = Math.max(60, Number(body.expires_in) || 3_600);
      this.tokens = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || this.tokens.refreshToken,
        expiresAt: Date.now() + expiresIn * 1_000,
        scope: body.scope || this.tokens.scope || this.scope,
        provider: "oauth",
        deviceId: this.tokens.deviceId,
      };
      await this.save();
      return this.tokens;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new OAuthAuthorizationRequiredError("Karotter OAuth token request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loginWithPassword({ identifier, password }) {
    if (!String(identifier || "").trim() || !String(password || "")) {
      throw new OAuthAuthorizationRequiredError("Karotter ID and password are required");
    }
    const body = await this.accountRequest("/auth/login", {
      identifier: String(identifier).trim(),
      password: String(password),
      deviceId: this.tokens.deviceId,
      clientType: "web",
      deviceName: "tbot on Render",
    });
    if (body?.twoFactorRequired && body?.twoFactorToken) {
      return { twoFactorRequired: true, twoFactorToken: body.twoFactorToken };
    }
    await this.storeAccountTokens(body);
    return { twoFactorRequired: false, user: body?.user || null };
  }

  async completeAccountTwoFactor({ twoFactorToken, code }) {
    if (!twoFactorToken || !String(code || "").trim()) {
      throw new OAuthAuthorizationRequiredError("Karotter two-factor authentication code is required");
    }
    const body = await this.accountRequest("/auth/login/2fa", {
      twoFactorToken,
      code: String(code).trim(),
      deviceId: this.tokens.deviceId,
      clientType: "web",
      deviceName: "tbot on Render",
    });
    await this.storeAccountTokens(body);
    return { user: body?.user || null };
  }

  async refreshAccountToken() {
    const body = await this.accountRequest("/auth/refresh-token", {
      refreshToken: this.tokens.refreshToken,
      deviceId: this.tokens.deviceId,
      clientType: "web",
      deviceName: "tbot on Render",
    });
    await this.storeAccountTokens(body);
    return this.tokens;
  }

  async storeAccountTokens(body) {
    if (!body?.accessToken) {
      throw new OAuthAuthorizationRequiredError("Karotter account login did not return an access token");
    }
    this.tokens = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken || this.tokens.refreshToken,
      expiresAt: accessTokenExpiresAt(body.accessToken, body.expiresIn || body.expires_in),
      scope: "account",
      provider: "account",
      deviceId: this.tokens.deviceId,
    };
    await this.save();
  }

  async accountRequest(pathname, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.accountBaseUrl}${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-type": "web",
          "x-device-id": this.tokens.deviceId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new OAuthAuthorizationRequiredError(
          body?.error || body?.message || `Karotter account login returned ${response.status}`,
        );
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new OAuthAuthorizationRequiredError("Karotter account login timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async save() {
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = `${this.tokenPath}.tmp`;
    const serialized = `${JSON.stringify({ version: 1, ...this.tokens }, null, 2)}\n`;
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.tokenPath);
  }
}
