import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMetrics, snapshotPost, zeroMetrics } from "../src/post-data.js";

test("normalizes Karotter Post counts", () => {
  assert.deepEqual(
    normalizeMetrics({
      likesCount: 10,
      rekarotsCount: 2,
      repliesCount: 3,
      viewsCount: 100,
      bookmarksCount: 1,
    }),
    { replies: 3, reposts: 2, likes: 10, bookmarks: 1, views: 100 },
  );
});

test("direct command post deliberately uses zero reactions", () => {
  const snapshot = snapshotPost(
    {
      id: 1,
      content: "hello",
      likesCount: 99,
      author: { id: 2, username: "alice", displayName: "Alice" },
    },
    { direct: true },
  );
  assert.deepEqual(snapshot.metrics, zeroMetrics());
  assert.equal(snapshot.author.handle, "@alice");
});

test("parent post keeps date, avatar, and reactions", () => {
  const snapshot = snapshotPost({
    id: 7,
    content: "parent",
    createdAt: "2026-09-20T10:00:00.000Z",
    likesCount: 8,
    author: {
      id: 9,
      username: "parent",
      displayName: "Parent",
      avatarUrl: "https://api.karotter.com/uploads/avatars/parent.webp",
    },
  });
  assert.equal(snapshot.createdAt, "2026-09-20T10:00:00.000Z");
  assert.equal(snapshot.author.avatarUrl, "https://api.karotter.com/uploads/avatars/parent.webp");
  assert.equal(snapshot.metrics.likes, 8);
});

test("relative Karotter avatar paths become fetchable absolute URLs", () => {
  const snapshot = snapshotPost({
    id: 9,
    content: "本文",
    author: {
      username: "alice",
      avatarUrl: "/uploads/avatars/alice.webp",
    },
  });

  assert.equal(
    snapshot.author.avatarUrl,
    "https://api.karotter.com/uploads/avatars/alice.webp",
  );
});
