import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/commands.js";

const cases = [
  ["今日の作戦会議 @tbot+quote", "quote", "今日の作戦会議"],
  ["@tbot neon サーバーは平穏", "neon", "サーバーは平穏"],
  ["了解 @tbot speech", "speech", "了解"],
  ["出荷 @tbot+判子 GO", "stamp", "出荷 GO"],
  ["今日の投稿メモ @tbot 投稿", "post", "今日の投稿メモ"],
  ["明日もきっと晴れる @tbot+詩", "poem", "明日もきっと晴れる"],
  ["ここが勝負どころ @tbot 集中線", "impact", "ここが勝負どころ"],
  ["小さく始める @tbot+名言", "iconquote", "小さく始める"],
];

for (const [input, commandId, content] of cases) {
  test(`parse ${input}`, () => {
    const parsed = parseCommand(input, "tbot");
    assert.equal(parsed.command.id, commandId);
    assert.equal(parsed.content, content);
  });
}

test("parseCommand preserves Markdown line breaks", () => {
  const parsed = parseCommand("# 見出し\n本文 $ E=mc^2 $\n@tbot gold", "tbot");
  assert.equal(parsed.content, "# 見出し\n本文 $ E=mc^2 $");
});

test("command-only reply", () => {
  const parsed = parseCommand("@tbot+gold", "tbot");
  assert.equal(parsed.command.id, "gold");
  assert.equal(parsed.commandOnly, true);
});

test("unknown command remains renderable", () => {
  const parsed = parseCommand("テスト @tbot+unknown", "tbot");
  assert.equal(parsed.command.id, "unknown");
  assert.equal(parsed.command.unknown, true);
});

test("unrelated mention is ignored", () => {
  assert.equal(parseCommand("@another quote", "tbot"), null);
});

test("a command requires a plus sign or whitespace after the bot username", () => {
  assert.equal(parseCommand("@tbotquote", "tbot"), null);
  assert.equal(parseCommand("@tbot", "tbot"), null);
});
