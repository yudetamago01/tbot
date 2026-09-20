import test from "node:test";
import assert from "node:assert/strict";
import { KarotterApiError, KarotterClient } from "../src/karotter-client.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("notification request uses documented query parameters and x-api-key auth", async () => {
  let captured;
  const client = new KarotterClient({
    apiKey: "secret-key",
    authMode: "x-api-key",
    baseUrl: "https://karotter.com/api/developer/",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({ notifications: [] });
    },
  });

  await client.getNotifications({ page: 2, limit: 25, type: "MENTION,REPLY" });

  const url = new URL(captured.url);
  assert.equal(url.origin + url.pathname, "https://karotter.com/api/developer/notifications");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("type"), "MENTION,REPLY");
  assert.equal(captured.options.headers["x-api-key"], "secret-key");
});

test("bearer auth and post response unwrapping work", async () => {
  let authorization;
  const client = new KarotterClient({
    apiKey: "bearer-key",
    authMode: "bearer",
    baseUrl: "https://karotter.com/api/developer",
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return jsonResponse({ post: { id: "post-1", content: "本文" } });
    },
  });

  const post = await client.getPost("post/with spaces");
  assert.equal(authorization, "Bearer bearer-key");
  assert.equal(post.id, "post-1");
});

test("OAuth mode obtains a current bearer token from its provider", async () => {
  let authorization;
  let providerCalls = 0;
  const client = new KarotterClient({
    authMode: "oauth",
    baseUrl: "https://karotter.com/api/developer",
    tokenProvider: async () => {
      providerCalls += 1;
      return "oauth-access-token";
    },
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return jsonResponse({ user: { id: "user-1" } });
    },
  });

  await client.getMe();
  assert.equal(authorization, "Bearer oauth-access-token");
  assert.equal(providerCalls, 1);
  assert.equal(client.hasAuthConfiguration(), true);
});

test("image replies are sent as multipart posts with parentId and media", async () => {
  let form;
  let method;
  const client = new KarotterClient({
    apiKey: "secret-key",
    authMode: "x-api-key",
    baseUrl: "https://karotter.com/api/developer",
    fetchImpl: async (_url, options) => {
      form = options.body;
      method = options.method;
      return jsonResponse({ post: { id: "reply-1" } });
    },
  });

  const result = await client.createPost({
    content: "\u2063",
    parentId: "parent-1",
    image: { buffer: Buffer.from("png"), mimeType: "image/png", filename: "tbot.png" },
  });

  assert.equal(method, "POST");
  assert.ok(form instanceof FormData);
  assert.equal(form.get("content"), "\u2063");
  assert.equal(form.get("parentId"), "parent-1");
  assert.equal(form.get("media").name, "tbot.png");
  assert.equal(form.get("media").type, "image/png");
  assert.equal(result.id, "reply-1");
});

test("429 errors expose retry-after delay", async () => {
  const client = new KarotterClient({
    apiKey: "secret-key",
    authMode: "x-api-key",
    baseUrl: "https://karotter.com/api/developer",
    fetchImpl: async () => jsonResponse({ error: "rate limited" }, {
      status: 429,
      headers: { "retry-after": "3" },
    }),
  });

  await assert.rejects(
    () => client.getNotifications(),
    (error) => {
      assert.ok(error instanceof KarotterApiError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 3_000);
      return true;
    },
  );
});
