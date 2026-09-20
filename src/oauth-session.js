import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1_000;

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
    timeoutMs = 15_000,
    fetchImpl = fetch,
    log,
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.scope = scope;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.tokenPath = path.resolve(tokenPath);
    this.initialRefreshToken = initialRefreshToken;
    this.stateSecret = stateSecret || clientSecret;
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
      mode: "oauth",
      configured: this.isConfigured(),
      authorized: Boolean(this.tokens.accessToken || this.tokens.refreshToken),
      expiresAt: this.tokens.expiresAt ? new Date(this.tokens.expiresAt).toISOString() : null,
      scope: this.tokens.scope,
    };
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
      this.refreshPromise = this.exchangeToken({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret || undefined,
      }).finally(() => {
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

  async save() {
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = `${this.tokenPath}.tmp`;
    const serialized = `${JSON.stringify({ version: 1, ...this.tokens }, null, 2)}\n`;
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.tokenPath);
  }
}
