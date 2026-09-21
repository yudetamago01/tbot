import assert from "node:assert/strict";
import test from "node:test";
import { parseMathExpression, tokenizeRichText } from "../src/rich-text.js";
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
  const tokens = parseMathExpression("\\frac{1}{2}+\\sqrt{x}+x_i^2+\\alpha\\times\\infty");
  assert.ok(tokens.some((token) => token.type === "frac"));
  assert.ok(tokens.some((token) => token.type === "sqrt"));
  assert.ok(tokens.some((token) => token.type === "sub"));
  assert.ok(tokens.some((token) => token.type === "sup"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "α"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "×"));
  assert.ok(tokens.some((token) => token.type === "char" && token.ch === "∞"));
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
