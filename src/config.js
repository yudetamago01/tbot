function integerEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

export function loadConfig() {
  const apiKey = String(process.env.KAROTTER_API_KEY || "").trim();
  const authMode = String(process.env.KAROTTER_AUTH_MODE || "oauth").trim().toLowerCase();
  if (!new Set(["x-api-key", "bearer", "oauth"]).has(authMode)) {
    throw new Error("KAROTTER_AUTH_MODE must be x-api-key, bearer, or oauth");
  }
  const baseUrl = String(
    process.env.KAROTTER_API_BASE_URL || "https://karotter.com/api/developer",
  ).replace(/\/+$/, "");
  const username = String(process.env.TBOT_USERNAME || "tbot").trim().replace(/^@/, "");
  const timeZone = String(process.env.TBOT_TIME_ZONE || "Asia/Tokyo").trim();
  try {
    new Intl.DateTimeFormat("ja-JP", { timeZone }).format();
  } catch {
    throw new Error("TBOT_TIME_ZONE must be a valid IANA time zone");
  }
  const avatarAllowedHosts = new Set(
    String(process.env.AVATAR_ALLOWED_HOSTS || "karotter.com,api.karotter.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    apiKey,
    authMode,
    baseUrl,
    username,
    timeZone,
    avatarAllowedHosts,
    pollIntervalMs: integerEnv("POLL_INTERVAL_MS", 15_000, { min: 5_000, max: 300_000 }),
    pollPageLimit: integerEnv("POLL_PAGE_LIMIT", 50, { min: 1, max: 100 }),
    maxNotificationsPerTick: integerEnv("MAX_NOTIFICATIONS_PER_TICK", 10, { min: 1, max: 50 }),
    httpTimeoutMs: integerEnv("HTTP_TIMEOUT_MS", 15_000, { min: 1_000, max: 60_000 }),
    requestsPerMinute: integerEnv("KAROTTER_REQUESTS_PER_MINUTE", 55, { min: 1, max: 60 }),
    statePath: String(process.env.STATE_PATH || "./data/state.json"),
    enablePolling: booleanEnv("ENABLE_POLLING", true),
    port: integerEnv("PORT", 3000, { min: 1, max: 65_535 }),
    oauth: {
      baseUrl: String(process.env.KAROTTER_OAUTH_BASE_URL || "https://api.karotter.com/api/oauth").replace(/\/+$/, ""),
      clientId: String(process.env.KAROTTER_OAUTH_CLIENT_ID || "").trim(),
      clientSecret: String(process.env.KAROTTER_OAUTH_CLIENT_SECRET || "").trim(),
      redirectUri: String(process.env.KAROTTER_OAUTH_REDIRECT_URI || "").trim(),
      scope: String(process.env.KAROTTER_OAUTH_SCOPE || "profile offline_access").trim(),
      tokenPath: String(process.env.KAROTTER_OAUTH_TOKEN_PATH || "./data/oauth.json"),
      refreshToken: String(process.env.KAROTTER_OAUTH_REFRESH_TOKEN || "").trim(),
      setupSecret: String(process.env.TBOT_SETUP_SECRET || ""),
    },
  };
}
