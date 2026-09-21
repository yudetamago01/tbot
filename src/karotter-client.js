export class KarotterApiError extends Error {
  constructor(message, { status, body, retryAfterMs } = {}) {
    super(message);
    this.name = "KarotterApiError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export class KarotterClient {
  constructor({
    apiKey,
    authMode,
    baseUrl,
    timeoutMs = 15_000,
    requestsPerMinute = 55,
    tokenProvider,
    deviceIdProvider,
    fetchImpl = fetch,
  }) {
    this.apiKey = apiKey;
    this.authMode = authMode;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.requestsPerMinute = requestsPerMinute;
    this.tokenProvider = tokenProvider;
    this.deviceIdProvider = deviceIdProvider;
    this.fetchImpl = fetchImpl;
    this.requestTimestamps = [];
    this.requestGate = Promise.resolve();
  }

  hasAuthConfiguration() {
    if (this.authMode === "oauth" || this.authMode === "account") return typeof this.tokenProvider === "function";
    return Boolean(this.apiKey);
  }

  async authHeaders() {
    if (this.authMode === "oauth" || this.authMode === "account") {
      const token = await this.tokenProvider();
      const headers = { Authorization: `Bearer ${token}` };
      if (this.authMode === "account") {
        headers["x-client-type"] = "android";
        headers["x-device-id"] = this.deviceIdProvider();
      }
      return headers;
    }
    if (this.authMode === "bearer") return { Authorization: `Bearer ${this.apiKey}` };
    return { "x-api-key": this.apiKey };
  }

  async throttle() {
    const previous = this.requestGate;
    let release;
    this.requestGate = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter((time) => now - time < 60_000);
        if (this.requestTimestamps.length < this.requestsPerMinute) {
          this.requestTimestamps.push(now);
          return;
        }
        const waitMs = Math.max(1, 60_000 - (now - this.requestTimestamps[0]) + 25);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      release();
    }
  }

  async request(pathname, options = {}) {
    await this.throttle();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { ...(await this.authHeaders()), ...(options.headers || {}) };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");
      if (!response.ok) {
        throw new KarotterApiError(
          body?.error || `Karotter API returned ${response.status}`,
          {
            status: response.status,
            body,
            retryAfterMs: retryAfterMs(response),
          },
        );
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new KarotterApiError(`Karotter API timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getMe() {
    return this.request(this.authMode === "account" ? "/auth/me" : "/users/me");
  }

  async getNotifications({ page = 1, limit = 50, type = "MENTION,REPLY" } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    query.set(this.authMode === "account" ? "types" : "type", type);
    return this.request(`/notifications?${query}`);
  }

  async getPost(postId) {
    const result = await this.request(`/posts/${encodeURIComponent(postId)}`);
    return result?.post || result;
  }

  async createPost({ content, parentId, quotedPostId, visibility, image }) {
    const form = new FormData();
    if (content != null && String(content).length > 0) {
      form.append("content", String(content));
    }
    if (parentId != null) form.append("parentId", String(parentId));
    if (quotedPostId != null) form.append("quotedPostId", String(quotedPostId));
    if (visibility) form.append("visibility", String(visibility));
    if (image) {
      const blob = new Blob([image.buffer], { type: image.mimeType || "image/png" });
      form.append("media", blob, image.filename || "tbot.png");
    }
    const result = await this.request("/posts", { method: "POST", body: form });
    return result?.post || result;
  }

  createTextReply({ content, parentId }) {
    return this.createPost({ content, parentId });
  }

  markNotificationRead(notificationId) {
    if (this.authMode === "account") {
      // The first-party API marks notification groups in bulk. Local durable
      // state prevents duplicate replies without racing newer notifications.
      return Promise.resolve({ skipped: true, notificationId });
    }
    return this.request(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "PATCH",
    });
  }
}
