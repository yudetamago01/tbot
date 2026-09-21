import assert from "node:assert/strict";
import test from "node:test";
import { BotService } from "../src/bot-service.js";

function fixture({ notifications = [], config = {} } = {}) {
  const calls = [];
  const logs = [];
  const getPostIds = [];
  const posts = new Map([
    [101, { id: 101, content: "親投稿", createdAt: "2026-09-20T01:00:00.000Z", likesCount: 12, author: { username: "alice", displayName: "Alice", avatarUrl: "/uploads/avatars/alice.webp" } }],
    [102, { id: 102, parentId: 101, content: "@tbot post", createdAt: "2026-09-20T01:01:00.000Z", author: { username: "bob", displayName: "Bob" } }],
    [103, { id: 103, content: "自分の文 @tbot post", createdAt: "2026-09-20T01:02:00.000Z", likesCount: 99, author: { username: "bob", displayName: "Bob" } }],
  ]);
  const client = {
    getNotifications: async () => ({ notifications }),
    getPost: async (id) => {
      getPostIds.push(Number(id));
      return posts.get(Number(id));
    },
    createPost: async (payload) => {
      calls.push(["createPost", payload]);
      return { id: 500 + calls.length };
    },
    createTextReply: async (payload) => calls.push(["createTextReply", payload]),
    markNotificationRead: async (id) => calls.push(["markRead", id]),
  };
  const saved = new Map();
  const processed = new Set();
  const stateStore = {
    getGeneratedSource: (id) => saved.get(String(id)) || null,
    rememberGeneratedPost: async (id, value) => saved.set(String(id), value),
    rememberProcessedNotification: async (id) => processed.add(String(id)),
    hasProcessedNotification: (id) => processed.has(String(id)),
  };
  const rendererCalls = [];
  const renderer = async (payload) => {
    rendererCalls.push(payload);
    return Buffer.from("png");
  };
  const service = new BotService({
    client,
    renderer,
    stateStore,
    config: {
      apiKey: "test-key",
      username: "tbot",
      avatarAllowedHosts: new Set(["karotter.com"]),
      pollIntervalMs: 15_000,
      pollPageLimit: 50,
      maxNotificationsPerTick: 10,
      ...config,
    },
    log: {
      info(message, fields) { logs.push(["info", message, fields]); },
      warn(message, fields) { logs.push(["warn", message, fields]); },
      error(message, fields) { logs.push(["error", message, fields]); },
    },
  });
  return { service, calls, rendererCalls, getPostIds, logs };
}

test("command-only reply renders the parent post and metrics", async () => {
  const { service, rendererCalls, calls, logs } = fixture();
  await service.processNotification({
    id: 1,
    type: "MENTION",
    createdAt: "2026-09-20T01:01:05.000Z",
    post: { id: 102 },
  });
  assert.equal(rendererCalls[0].text, "親投稿");
  assert.equal(rendererCalls[0].profile.handle, "@alice");
  assert.equal(rendererCalls[0].profile.avatarUrl, "https://api.karotter.com/uploads/avatars/alice.webp");
  assert.equal(rendererCalls[0].post.metrics.likes, 12);
  assert.equal(calls[0][1].parentId, 102);
  assert.equal(Object.hasOwn(calls[0][1], "content"), false);
  assert.deepEqual(
    logs.find(([, message]) => message === "mention_detected"),
    ["info", "mention_detected", {
      notificationId: 1,
      postId: 102,
      author: "bob",
      command: "post",
      commandOnly: true,
      notificationType: "MENTION",
      notificationCreatedAt: "2026-09-20T01:01:05.000Z",
    }],
  );
});

test("direct post command renders zero reactions", async () => {
  const { service, rendererCalls } = fixture();
  await service.processNotification({ id: 2, post: { id: 103 } });
  assert.equal(rendererCalls[0].text, "自分の文");
  assert.deepEqual(rendererCalls[0].post.metrics, {
    replies: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
  });
});

test("a poll discards pre-start notifications without delaying new ones", async () => {
  const { service, calls, rendererCalls, getPostIds } = fixture({
    notifications: [
      { id: 10, createdAt: "2026-09-20T01:00:00.000Z", post: { id: 103 } },
      { id: 11, createdAt: "2026-09-20T01:02:00.000Z", post: { id: 103 } },
    ],
    config: { maxNotificationsPerTick: 1 },
  });
  service.status.startedAt = "2026-09-20T01:01:00.000Z";
  service.schedule = () => {};

  await service.tick();

  assert.equal(rendererCalls.length, 1);
  assert.deepEqual(getPostIds, [103]);
  assert.deepEqual(
    calls.filter(([name]) => name === "markRead").map(([, id]) => id),
    [10, 11],
  );
  assert.equal(service.status.ignored, 1);
  assert.equal(service.status.processed, 1);
});

test("health exposes only public bot identity fields", () => {
  const { service } = fixture();
  service.status.botUser = {
    id: 42433,
    username: "tbot",
    displayName: "textbot",
    avatarUrl: "/avatar.webp",
    isBotAccount: true,
    email: "private@example.com",
    birthday: "2011-05-31",
  };

  assert.deepEqual(service.health().botUser, {
    id: 42433,
    username: "tbot",
    displayName: "textbot",
    avatarUrl: "/avatar.webp",
    isBotAccount: true,
  });
});
