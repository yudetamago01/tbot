import assert from "node:assert/strict";
import test from "node:test";
import { BotService } from "../src/bot-service.js";

function fixture() {
  const calls = [];
  const posts = new Map([
    [101, { id: 101, content: "親投稿", createdAt: "2026-09-20T01:00:00.000Z", likesCount: 12, author: { username: "alice", displayName: "Alice", avatarUrl: "https://api.karotter.com/a.webp" } }],
    [102, { id: 102, parentId: 101, content: "@tbot post", createdAt: "2026-09-20T01:01:00.000Z", author: { username: "bob", displayName: "Bob" } }],
    [103, { id: 103, content: "自分の文 @tbot post", createdAt: "2026-09-20T01:02:00.000Z", likesCount: 99, author: { username: "bob", displayName: "Bob" } }],
  ]);
  const client = {
    getPost: async (id) => posts.get(Number(id)),
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
      username: "tbot",
      avatarAllowedHosts: new Set(["karotter.com"]),
      pollIntervalMs: 15_000,
    },
    log: { info() {}, warn() {}, error() {} },
  });
  return { service, calls, rendererCalls };
}

test("command-only reply renders the parent post and metrics", async () => {
  const { service, rendererCalls, calls } = fixture();
  await service.processNotification({ id: 1, post: { id: 102 } });
  assert.equal(rendererCalls[0].text, "親投稿");
  assert.equal(rendererCalls[0].profile.handle, "@alice");
  assert.equal(rendererCalls[0].post.metrics.likes, 12);
  assert.equal(calls[0][1].parentId, 102);
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
