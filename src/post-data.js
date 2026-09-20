export function zeroMetrics() {
  return { replies: 0, reposts: 0, likes: 0, bookmarks: 0, views: 0 };
}

function count(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return 0;
}

export function normalizeMetrics(post) {
  const direct = post || {};
  const nested = direct._count || {};
  return {
    replies: count(direct, "repliesCount", "replyCount") || count(nested, "replies"),
    reposts: count(direct, "rekarotsCount", "repostsCount") || count(nested, "rekarots"),
    likes: count(direct, "likesCount", "likeCount") || count(nested, "likes"),
    bookmarks: count(direct, "bookmarksCount", "bookmarkCount") || count(nested, "bookmarks"),
    views: count(direct, "viewsCount", "viewCount"),
  };
}

export function normalizeProfile(author = {}) {
  const username = String(author.username || "unknown").replace(/^@/, "");
  return {
    id: author.id ?? null,
    name: author.displayName || author.name || username,
    handle: `@${username}`,
    username,
    avatarUrl: author.avatarUrl || null,
  };
}

export function snapshotPost(post, { direct = false } = {}) {
  const value = post || {};
  return {
    id: value.id ?? null,
    content: String(value.content || ""),
    createdAt: value.createdAt || new Date().toISOString(),
    author: normalizeProfile(value.author || {}),
    metrics: direct ? zeroMetrics() : normalizeMetrics(value),
  };
}
