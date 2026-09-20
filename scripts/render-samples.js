import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMMANDS } from "../src/commands.js";
import { renderImage } from "../src/renderer.js";

const outputDirectory = path.resolve("artifacts/samples");
await mkdir(outputDirectory, { recursive: true });

const texts = {
  help: "",
  quote: "結論から書く",
  fancy: "今夜のテーマ",
  neon: "サーバーは平穏",
  glitch: "テキストが乱れる",
  stamp: "承認",
  pixel: "休憩中",
  banner: "本日メンテナンス",
  speech: "了解しました",
  mono: "静かなログ",
  rainbow: "公開しました",
  sticker: "おすすめ",
  code: "build succeeded",
  gold: "限定公開",
  post: "今日の投稿メモ",
  poem: "明日もきっと晴れる",
  impact: "ここが勝負どころ",
  iconquote: "小さく始めて大きく育てる",
};

const profile = {
  id: 45,
  name: "設計ノート",
  username: "design_note",
  handle: "@design_note",
  avatarUrl: null,
};
const post = {
  id: 123,
  createdAt: "2026-09-20T12:34:56.789Z",
  metrics: { replies: 4, reposts: 7, likes: 18, bookmarks: 3, views: 240 },
};

for (const command of COMMANDS) {
  const png = await renderImage({
    commandId: command.id,
    text: texts[command.id] || command.id,
    profile,
    post,
    avatarAllowedHosts: new Set(["karotter.com", "api.karotter.com"]),
  });
  const file = path.join(outputDirectory, `${command.id}.png`);
  await writeFile(file, png);
  console.log(file);
}
