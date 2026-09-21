import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  drawRichWithTheme,
  parseMathExpression,
  tokenizeRichText,
  wrapRichRuns,
} from "../src/rich-text.js";
import { renderImage } from "../src/renderer.js";

test("Markdown syntax becomes styled runs instead of visible punctuation", () => {
  const runs = tokenizeRichText("# 見出し\n**太字** *斜体* ~~取消~~ `code` [link](https://example.com)");
  assert.ok(runs.some((run) => run.text === "見出し" && run.bold && run.size > 1));
  assert.ok(runs.some((run) => run.text === "太字" && run.bold));
  assert.ok(runs.some((run) => run.text === "斜体" && run.italic));
  assert.ok(runs.some((run) => run.text === "取消" && run.strike));
  assert.ok(runs.some((run) => run.text === "code" && run.code));
  assert.ok(runs.some((run) => run.text === "link" && run.link));
  assert.ok(!runs.some((run) => /\*\*|~~|`|\]\(/.test(run.text)));
});

test("Karotter-compatible single tildes and rendered HTML are accepted", () => {
  const runs = tokenizeRichText("~取消~ <strong>太字</strong> <em>斜体</em>");
  assert.ok(runs.some((run) => run.text === "取消" && run.strike));
  assert.ok(runs.some((run) => run.text === "太字" && run.bold));
  assert.ok(runs.some((run) => run.text === "斜体" && run.italic));
  assert.ok(!runs.some((run) => /[~<>]/.test(run.text)));
});

test("inline and display math become math runs", () => {
  const runs = tokenizeRichText("速度は $ v=\\frac{d}{t} $\n$$E=mc^2$$ \\(x_i^2\\) \\[\\sqrt{x}\\]");
  assert.ok(runs.some((run) => run.math && !run.block && run.text === "v=\\frac{d}{t}"));
  assert.ok(runs.some((run) => run.math && run.block && run.text === "E=mc^2"));
  assert.ok(runs.some((run) => run.math && !run.block && run.text === "x_i^2"));
  assert.ok(runs.some((run) => run.math && run.block && run.text === "\\sqrt{x}"));
});

test("the offline TeX parser supports fractions, roots, scripts, Greek, and operators", () => {
  const tokens = parseMathExpression("\\frac{1}{2}+\\sqrt{x}+x_i^2+\\alpha\\times\\infty+\\color{#7c83ff}{焦らない}");
  assert.ok(tokens.some((token) => token.type === "frac"));
  assert.ok(tokens.some((token) => token.type === "sqrt"));
  assert.ok(tokens.some((token) => token.type === "sub"));
  assert.ok(tokens.some((token) => token.type === "sup"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "α"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "×"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "∞"));
  assert.ok(tokens.some((token) => token.type === "color" && token.color === "#7c83ff" && token.body === "焦らない"));
});

test("rich text wrapping never replaces user text with an ellipsis", () => {
  const ctx = createCanvas(200, 200).getContext("2d");
  const original = "とても長い文章でも一文字も省略しない";
  const lines = wrapRichRuns(ctx, tokenizeRichText(original), 48, 24, "Noto Sans JP");
  const rendered = lines.flat().map((run) => run.text).join("");
  assert.equal(rendered, original);
  assert.ok(!rendered.includes("…"));
});

test("long non-post text scales down to keep about 200 characters in the composition", () => {
  const ctx = createCanvas(720, 420).getContext("2d");
  const layout = drawRichWithTheme(ctx, "長".repeat(200), {
    theme: "plain",
    mode: "center",
    cx: 360,
    centerY: 210,
    fontSize: 49,
    maxWidth: 620,
    maxLines: 3,
    lineGap: 58,
  });
  assert.ok(layout.fontSize < 49);
  assert.ok(layout.fontSize >= 12);
  assert.ok(layout.layoutHeight <= 3 * 58 * 1.08 * 1.12);
});

test("post text keeps its fixed typography when adaptive fitting is disabled", () => {
  const ctx = createCanvas(720, 420).getContext("2d");
  const layout = drawRichWithTheme(ctx, "長".repeat(200), {
    theme: "post",
    mode: "left",
    cx: 44,
    topY: 128,
    fontSize: 28,
    maxWidth: 632,
    maxLines: Number.POSITIVE_INFINITY,
    lineGap: 40,
    adaptive: false,
  });
  assert.equal(layout.fontSize, 28);
});

test("the production renderer accepts rich text in Gold and post themes", async () => {
  const profile = { name: "テスト", handle: "@test", avatarUrl: null };
  const richText = "**重要**: $E=mc^2$ と `code`";
  for (const commandId of ["gold", "post"]) {
    const png = await renderImage({ commandId, text: richText, profile });
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.length > 10_000);
  }
});

test("the exact single-tilde Gold input is rendered as markup", async () => {
  const png = await renderImage({ commandId: "gold", text: "~あ~", profile: { handle: "@test" } });
  assert.ok(png.length > 10_000);
  const runs = tokenizeRichText("~あ~");
  assert.deepEqual(runs.map(({ text, strike }) => ({ text, strike })), [{ text: "あ", strike: true }]);
});

test("Gold renders emoji and KaTeX color input without rejecting it", async () => {
  const text = "🌃夜のメモ\n$\\color{#7c83ff}{焦らなくていい}$";
  assert.equal(tokenizeRichText(text).some((run) => run.text.includes("🌃")), true);
  const png = await renderImage({ commandId: "gold", text, profile: { handle: "@test" } });
  assert.ok(png.length > 10_000);
});

test("Poem renders brush-style short and 200-character layouts", async () => {
  const profile = { handle: "@test" };
  const short = await renderImage({ commandId: "poem", text: "明日もきっと晴れる", profile });
  const long = await renderImage({ commandId: "poem", text: "長".repeat(200), profile });
  assert.ok(short.length > 10_000);
  assert.ok(long.length > 10_000);
});
