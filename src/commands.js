export const COMMANDS = [
  { id: "help", aliases: ["ヘルプ", "?"], description: "コマンド一覧" },
  { id: "quote", aliases: ["引用"], description: "引用カード" },
  { id: "fancy", aliases: ["おしゃれ", "serif"], description: "上品な見出し" },
  { id: "neon", aliases: [], description: "ネオン発光" },
  { id: "glitch", aliases: [], description: "RGBグリッチ" },
  { id: "stamp", aliases: ["判子", "ハンコ"], description: "朱印スタンプ" },
  { id: "pixel", aliases: [], description: "ドット文字" },
  { id: "banner", aliases: [], description: "告知バナー" },
  { id: "speech", aliases: ["吹き出し"], description: "吹き出し" },
  { id: "mono", aliases: [], description: "モノクロ組版" },
  { id: "rainbow", aliases: ["レインボー"], description: "虹色" },
  { id: "sticker", aliases: [], description: "ステッカー" },
  { id: "code", aliases: [], description: "CMD表示" },
  { id: "gold", aliases: ["ゴールド", "金"], description: "ゴールド演出" },
  { id: "post", aliases: ["投稿", "ポスト", "sns"], description: "SNS投稿カード" },
  { id: "poem", aliases: ["詩", "書"], description: "詩・書風" },
  { id: "impact", aliases: ["集中線", "迫力"], description: "漫画の集中線" },
  { id: "iconquote", aliases: ["名言", "アイコン名言"], description: "アイコン付き名言" },
];

const commandIndex = new Map();
for (const command of COMMANDS) {
  for (const name of [command.id, ...command.aliases]) {
    commandIndex.set(String(name).toLowerCase(), command);
  }
}

export function parseCommand(input, botUsername = "tbot") {
  const text = String(input || "");
  const escapedUsername = String(botUsername || "tbot").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `@${escapedUsername}(?:\\s*[+＋]\\s*|\\s+)((?:[A-Za-z?]|[一-龠ぁ-んァ-ヶー])+)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const command = commandIndex.get(token) || {
    id: token,
    aliases: [],
    description: "未登録のコマンド",
    unknown: true,
  };
  const content = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim();
  return {
    command,
    content,
    commandOnly: content.length === 0,
    matchedText: match[0],
  };
}
