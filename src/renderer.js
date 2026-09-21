import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import {
  Bookmark,
  ChartNoAxesColumnIncreasing,
  Heart,
  MessageCircle,
  Repeat2,
  Share,
} from "lucide-static";
import { COMMANDS } from "./commands.js";
import { zeroMetrics } from "./post-data.js";

const WIDTH = 720;
const HEIGHT = 420;
const SCALE = 2;
const SANS = '"TBOT Sans", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
const SERIF = '"TBOT Serif", "Noto Serif CJK JP", "Yu Mincho", serif';
const MONO = '"Cascadia Mono", Consolas, "MS Gothic", monospace';
const SNS_ICON_COLOR = "#536471";

const snsIconSources = {
  reply: MessageCircle,
  repost: Repeat2,
  like: Heart,
  views: ChartNoAxesColumnIncreasing,
  bookmark: Bookmark,
  share: Share,
};

const snsIcons = Object.fromEntries(await Promise.all(
  Object.entries(snsIconSources).map(async ([name, svg]) => {
    const rasterSvg = svg
      .replaceAll("currentColor", SNS_ICON_COLOR)
      .replace('width="24"', 'width="96"')
      .replace('height="24"', 'height="96"');
    return [name, await loadImage(Buffer.from(rasterSvg))];
  }),
));

let fontsRegistered = false;
const bundledSans = fileURLToPath(new URL("../assets/fonts/NotoSansJP.ttf", import.meta.url));
const bundledSerif = fileURLToPath(new URL("../assets/fonts/NotoSerifJP.ttf", import.meta.url));

function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const candidates = [
    ["TBOT Sans", process.env.TBOT_FONT_SANS],
    ["TBOT Serif", process.env.TBOT_FONT_SERIF],
    ["TBOT Sans", bundledSans],
    ["TBOT Serif", bundledSerif],
    ["TBOT Sans", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"],
    ["TBOT Serif", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"],
    ["TBOT Sans", "C:\\Windows\\Fonts\\YuGothM.ttc"],
    ["TBOT Serif", "C:\\Windows\\Fonts\\yumin.ttf"],
  ];
  for (const [family, file] of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      GlobalFonts.registerFromPath(file, family);
    } catch {
      // A system fallback remains available if a font cannot be registered.
    }
  }
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value || "")) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomFor(seed) {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function plainText(value) {
  return String(value || "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, value, maxWidth, maxLines = 4) {
  const chars = Array.from(plainText(value));
  const lines = [];
  let current = "";
  for (const char of chars) {
    const candidate = current + char;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.join("").length < chars.length && lines.length) {
    let tail = lines.at(-1);
    while (tail && ctx.measureText(`${tail}…`).width > maxWidth) tail = tail.slice(0, -1);
    lines[lines.length - 1] = `${tail}…`;
  }
  return lines.length ? lines : ["…"];
}

function drawTextBlock(ctx, value, options = {}) {
  const family = options.family || SANS;
  let fontSize = options.fontSize || 44;
  const weight = options.weight || 700;
  const maxWidth = options.maxWidth || 560;
  const maxLines = options.allowOverflow ? Number.POSITIVE_INFINITY : options.maxLines || 4;
  const minFontSize = options.allowOverflow ? fontSize : options.minFontSize || 22;
  let lines;
  while (fontSize >= minFontSize) {
    ctx.font = `${weight} ${fontSize}px ${family}`;
    lines = wrapText(ctx, value, maxWidth, maxLines);
    const consumed = lines.join("").replace(/…$/, "").length;
    if (consumed >= plainText(value).length || fontSize <= minFontSize) break;
    fontSize -= 2;
  }
  const lineHeight = options.lineHeight || fontSize * 1.32;
  const totalHeight = lines.length * lineHeight;
  const centerY = options.centerY ?? HEIGHT / 2;
  const startY = options.topY ?? centerY - totalHeight / 2 + lineHeight / 2;
  const x = options.x ?? WIDTH / 2;
  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.fillStyle = options.color || "#111";
  ctx.textAlign = options.align || "center";
  ctx.textBaseline = "middle";
  if (options.shadowColor) {
    ctx.shadowColor = options.shadowColor;
    ctx.shadowBlur = options.shadowBlur || 8;
    ctx.shadowOffsetX = options.shadowOffsetX || 0;
    ctx.shadowOffsetY = options.shadowOffsetY || 0;
  }
  if (options.strokeColor) {
    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = options.strokeWidth || 3;
    ctx.lineJoin = "round";
  }
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    if (options.strokeColor) ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });
  ctx.restore();
  return { lines, fontSize, lineHeight };
}

function paperTexture(ctx, seed, { color = "70,55,40", alpha = 0.025, specks = 650 } = {}) {
  const random = randomFor(seed);
  ctx.save();
  for (let i = 0; i < specks; i += 1) {
    ctx.fillStyle = `rgba(${color},${alpha * (0.3 + random())})`;
    const size = 0.25 + random() * 1.1;
    ctx.fillRect(random() * WIDTH, random() * HEIGHT, size, size);
  }
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 60; i += 1) {
    const y = random() * HEIGHT;
    ctx.strokeStyle = `rgba(${color},${alpha * 0.55})`;
    ctx.beginPath();
    ctx.moveTo(random() * WIDTH, y);
    ctx.lineTo(random() * WIDTH, y + (random() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function vignette(ctx, alpha = 0.38) {
  const gradient = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 70, WIDTH / 2, HEIGHT / 2, 520);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.65, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function profileColors(handle) {
  const palettes = [
    ["#ff8a4c", "#ff5c1a"],
    ["#60a5fa", "#2563eb"],
    ["#34d399", "#059669"],
    ["#f472b6", "#db2777"],
    ["#fbbf24", "#d97706"],
    ["#a78bfa", "#7c3aed"],
  ];
  return palettes[hash(handle) % palettes.length];
}

function drawAvatar(ctx, profile, image, x, y, size, { grayscale = false } = {}) {
  const radius = size / 2;
  const [a, b] = profileColors(profile?.handle);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    const width = image.width || size;
    const height = image.height || size;
    const scale = Math.max(size / width, size / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    if (grayscale) ctx.filter = "grayscale(1) contrast(1.12) brightness(0.9)";
    ctx.drawImage(image, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, grayscale ? "#666a70" : a);
    gradient.addColorStop(1, grayscale ? "#17191d" : b);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    const initial = Array.from(String(profile?.name || profile?.handle || "U").replace(/^@/, ""))[0] || "U";
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(size * 0.42)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, x + radius, y + radius + 1);
  }
  ctx.restore();
}

function drawByline(ctx, profile, color = "rgba(255,255,255,0.58)", x = WIDTH - 26, y = HEIGHT - 20) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `600 13px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText(profile?.handle || "@you", x, y);
  ctx.restore();
}

function drawHelp(ctx) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 28px ${SANS}`;
  ctx.fillText("@tbot コマンド", 30, 48);
  ctx.fillStyle = "#ff6a2a";
  ctx.fillRect(30, 61, 52, 3);
  ctx.fillStyle = "#8b98aa";
  ctx.font = `600 13px ${MONO}`;
  ctx.textAlign = "right";
  ctx.fillText("例: @tbot quote", WIDTH - 30, 47);
  const half = Math.ceil(COMMANDS.length / 2);
  COMMANDS.forEach((command, index) => {
    const column = index < half ? 0 : 1;
    const row = index < half ? index : index - half;
    const x = column ? 366 : 26;
    const y = 91 + row * 35;
    ctx.fillStyle = row % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.06)";
    roundedRect(ctx, x, y - 20, 328, 31, 7);
    ctx.fill();
    ctx.fillStyle = "#67e8f9";
    ctx.font = `700 14px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillText(`@tbot ${command.id}`, x + 12, y);
    ctx.fillStyle = "#c0c8d4";
    ctx.font = `500 12px ${SANS}`;
    ctx.fillText(command.description, x + 156, y);
  });
}

function drawQuote(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#f2ede3");
  background.addColorStop(1, "#fffdf7");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `quote:${text}`);
  ctx.fillStyle = "#22201d";
  ctx.font = `700 12px ${SANS}`;
  ctx.fillText("QUOTE", 40, 48);
  ctx.fillStyle = "#cc5b36";
  ctx.fillRect(40, 61, 36, 3);
  ctx.fillStyle = "rgba(34,32,29,0.18)";
  ctx.fillRect(88, 62, WIDTH - 128, 1);
  drawTextBlock(ctx, text, { family: SERIF, fontSize: 42, maxWidth: 584, maxLines: 4, color: "#201f1c" });
}

function drawFancy(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#10131b");
  background.addColorStop(0.55, "#222638");
  background.addColorStop(1, "#10131b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "rgba(232,207,154,0.48)";
  ctx.lineWidth = 1;
  ctx.strokeRect(38.5, 38.5, WIDTH - 77, HEIGHT - 77);
  ctx.strokeRect(47.5, 47.5, WIDTH - 95, HEIGHT - 95);
  drawTextBlock(ctx, text, { family: SERIF, fontSize: 44, maxWidth: 570, maxLines: 4, color: "#fffaf0", weight: 600 });
  vignette(ctx, 0.4);
}

function drawNeon(ctx, text) {
  const background = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0, WIDTH / 2, HEIGHT / 2, 500);
  background.addColorStop(0, "#11152a");
  background.addColorStop(0.58, "#070a15");
  background.addColorStop(1, "#020308");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.shadowColor = "#22d3ee";
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(34,211,238,0.6)";
  ctx.lineWidth = 3;
  roundedRect(ctx, 74, 74, WIDTH - 148, HEIGHT - 148, 50);
  ctx.stroke();
  ctx.restore();
  drawTextBlock(ctx, text, { fontSize: 49, maxWidth: 540, maxLines: 3, color: "#f8feff", shadowColor: "#22d3ee", shadowBlur: 18 });
  vignette(ctx, 0.44);
}

function drawGlitch(ctx, text) {
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const random = randomFor(`glitch:${text}`);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 1; y < HEIGHT; y += 5) ctx.fillRect(0, y, WIDTH, 1);
  for (let i = 0; i < 10; i += 1) {
    const y = 20 + random() * 380;
    const width = 30 + random() * 180;
    ctx.fillStyle = i % 2 ? "rgba(0,229,255,0.18)" : "rgba(255,18,79,0.2)";
    ctx.fillRect(i % 2 ? WIDTH - width : 0, y, width, 1 + random() * 5);
  }
  drawTextBlock(ctx, text, { fontSize: 48, maxWidth: 560, maxLines: 3, color: "#f7f7f8", shadowColor: "#00e5ff", shadowBlur: 2, shadowOffsetX: 4 });
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.translate(-4, 2);
  drawTextBlock(ctx, text, { fontSize: 48, maxWidth: 560, maxLines: 3, color: "#ff124f" });
  ctx.restore();
  vignette(ctx, 0.35);
}

function drawStamp(ctx, text) {
  ctx.fillStyle = "#f6f1e7";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `stamp:${text}`, { alpha: 0.035, specks: 900 });
  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT / 2);
  ctx.rotate(-0.045);
  ctx.strokeStyle = "rgba(157,18,35,0.92)";
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.arc(0, 0, 146, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 124, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawTextBlock(ctx, text, { fontSize: 47, maxWidth: 230, maxLines: 3, color: "#9d1223", weight: 900, centerY: HEIGHT / 2 });
}

function drawPixel(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, "#20164f");
  background.addColorStop(0.58, "#112b54");
  background.addColorStop(1, "#081b32");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const random = randomFor(`pixel:${text}`);
  const colors = ["#67e8f9", "#f9a8d4", "#fde68a"];
  for (let i = 0; i < 72; i += 1) {
    const size = i % 8 === 0 ? 4 : 2;
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.3 + random() * 0.6;
    ctx.fillRect(Math.floor(random() * 180) * 4, Math.floor(random() * 105) * 4, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(5,12,32,0.58)";
  ctx.fillRect(46, 62, WIDTH - 92, HEIGHT - 124);
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = 4;
  ctx.strokeRect(46, 62, WIDTH - 92, HEIGHT - 124);
  drawTextBlock(ctx, text, { family: MONO, fontSize: 50, maxWidth: 540, maxLines: 3, color: "#fef08a", shadowColor: "#6d0a92", shadowBlur: 0, shadowOffsetX: 6, shadowOffsetY: 7 });
  vignette(ctx, 0.34);
}

function drawBanner(ctx, text) {
  ctx.fillStyle = "#eee9df";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `banner:${text}`, { alpha: 0.02, color: "34,45,70" });
  const band = ctx.createLinearGradient(0, 0, WIDTH, 0);
  band.addColorStop(0, "#173b78");
  band.addColorStop(0.5, "#2457a7");
  band.addColorStop(1, "#173b78");
  ctx.fillStyle = band;
  ctx.fillRect(0, 106, WIDTH, 208);
  ctx.fillStyle = "#f05a35";
  ctx.fillRect(0, 96, WIDTH, 10);
  ctx.fillRect(0, 314, WIDTH, 10);
  drawTextBlock(ctx, text, { x: 70, align: "left", fontSize: 45, maxWidth: 580, maxLines: 3, color: "#fffaf2", centerY: HEIGHT / 2 });
}

function drawSpeech(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#dfeafc");
  background.addColorStop(1, "#eee7fa");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const x = 64;
  const y = 58;
  const width = WIDTH - 128;
  const height = 264;
  ctx.save();
  ctx.shadowColor = "rgba(55,65,115,0.2)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fff";
  roundedRect(ctx, x, y, width, height, 38);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 96, y + height - 2);
  ctx.lineTo(x + 130, y + height + 46);
  ctx.lineTo(x + 165, y + height - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#5964c9";
  ctx.lineWidth = 3.5;
  roundedRect(ctx, x, y, width, height, 38);
  ctx.stroke();
  drawTextBlock(ctx, text, { fontSize: 44, maxWidth: width - 110, maxLines: 4, color: "#172033", centerY: y + height / 2 });
}

function drawMono(ctx, text) {
  ctx.fillStyle = "#f3f3f0";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `mono:${text}`, { color: "0,0,0", alpha: 0.016 });
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 104, HEIGHT);
  ctx.fillRect(128, 38, 1, HEIGHT - 76);
  ctx.fillRect(WIDTH - 38, 38, 1, HEIGHT - 76);
  ctx.beginPath();
  ctx.moveTo(152, 54);
  ctx.lineTo(WIDTH - 64, 54);
  ctx.moveTo(152, HEIGHT - 54);
  ctx.lineTo(WIDTH - 64, HEIGHT - 54);
  ctx.stroke();
  drawTextBlock(ctx, text, { family: SERIF, x: 168, align: "left", fontSize: 43, maxWidth: 490, maxLines: 4, color: "#0c0c0c" });
}

function drawRainbow(ctx, text) {
  const rainbow = ["#ff0033", "#ff6600", "#ffcc00", "#33ff66", "#00ccff", "#3366ff", "#cc33ff"];
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  rainbow.forEach((color, index) => background.addColorStop(index / (rainbow.length - 1), color));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const lettering = ctx.createLinearGradient(WIDTH * 0.25, 0, WIDTH * 0.75, 0);
  [...rainbow].reverse().forEach((color, index) => {
    lettering.addColorStop(index / (rainbow.length - 1), color);
  });
  drawTextBlock(ctx, text, {
    fontSize: 50,
    maxWidth: 570,
    maxLines: 3,
    color: lettering,
    strokeColor: "rgba(8,10,18,0.88)",
    strokeWidth: 6,
    shadowColor: "rgba(255,255,255,0.45)",
    shadowBlur: 5,
  });
}

function drawSticker(ctx, text) {
  ctx.fillStyle = "#f5f7fb";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `sticker:${text}`, { color: "40,50,70", alpha: 0.014, specks: 380 });
  drawTextBlock(ctx, text, { fontSize: 50, maxWidth: 570, maxLines: 3, color: "#ff5368", weight: 900, shadowColor: "#fff", shadowBlur: 9 });
}

function drawCode(ctx, text, profile) {
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const username = String(profile?.handle || "@you").replace(/^@/, "") || "you";
  const prompt = `C:\\Users\\${username}>`;
  ctx.fillStyle = "#f2f2f2";
  ctx.font = `400 25px ${MONO}`;
  ctx.textAlign = "left";
  const value = `${prompt}${plainText(text)}`;
  const lines = wrapText(ctx, value, WIDTH - 64, 6);
  const lineHeight = 37;
  const firstY = (HEIGHT - lines.length * lineHeight) / 2 + 27;
  lines.forEach((line, index) => ctx.fillText(line, 32, firstY + index * lineHeight));
}

function drawGold(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#5b3307");
  background.addColorStop(0.24, "#bd7a13");
  background.addColorStop(0.5, "#f0c75a");
  background.addColorStop(0.72, "#a8630b");
  background.addColorStop(1, "#4b2805");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const focus = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0, WIDTH / 2, HEIGHT / 2, 300);
  focus.addColorStop(0, "rgba(255,253,230,0.72)");
  focus.addColorStop(0.45, "rgba(255,230,137,0.16)");
  focus.addColorStop(1, "rgba(91,46,4,0)");
  ctx.fillStyle = focus;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const random = randomFor(`gold:${text}`);
  for (let i = 0; i < 24; i += 1) {
    const x = 40 + random() * 640;
    const y = 36 + random() * 348;
    ctx.strokeStyle = `rgba(255,251,229,${0.24 + random() * 0.55})`;
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  }
  drawTextBlock(ctx, text, { fontSize: 49, maxWidth: 590, maxLines: 3, color: "#fff8d0", weight: 900, shadowColor: "#6e3d04", shadowBlur: 7, shadowOffsetY: 6 });
  vignette(ctx, 0.32);
}

function formatCount(value) {
  const number = Math.max(0, Math.floor(Number(value) || 0));
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(number);
}

function dateLabel(value, timeZone = "Asia/Tokyo") {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? `${month}月${day}日` : "";
}

function drawSnsIcon(ctx, kind, cx, cy, size = 20) {
  const icon = snsIcons[kind];
  if (!icon) return;
  ctx.drawImage(icon, cx - size / 2, cy - size / 2, size, size);
}

function drawPost(ctx, text, profile, post, avatarImage, timeZone) {
  const metrics = post?.metrics || zeroMetrics();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "#cfd9de";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
  drawAvatar(ctx, profile, avatarImage, 44, 30, 64);
  const mx = 124;
  ctx.fillStyle = "#0f1419";
  ctx.font = `700 24px ${SANS}`;
  ctx.textAlign = "left";
  const displayName = String(profile?.name || "あなた").slice(0, 16);
  ctx.fillText(displayName, mx, 56);
  const nameWidth = ctx.measureText(displayName).width;
  ctx.fillStyle = "#536471";
  ctx.font = `400 18px ${SANS}`;
  const handle = profile?.handle || "@you";
  ctx.fillText(handle, mx + nameWidth + 10, 56);
  const handleWidth = ctx.measureText(handle).width;
  ctx.fillText(`· ${dateLabel(post?.createdAt, timeZone)}`, mx + nameWidth + handleWidth + 20, 56);
  drawTextBlock(ctx, text, {
    x: 44,
    align: "left",
    topY: 132,
    fontSize: 28,
    maxWidth: WIDTH - 88,
    allowOverflow: true,
    color: "#0f1419",
    weight: 700,
  });
  const dividerY = HEIGHT - 76;
  ctx.strokeStyle = "#eff3f4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(44, dividerY);
  ctx.lineTo(WIDTH - 44, dividerY);
  ctx.stroke();
  const items = [
    ["reply", metrics.replies],
    ["repost", metrics.reposts],
    ["like", metrics.likes],
    ["views", metrics.views],
    ["bookmark", metrics.bookmarks],
    ["share", null],
  ];
  const left = 64;
  const step = (WIDTH - 128) / (items.length - 1);
  items.forEach(([kind, count], index) => {
    const x = left + index * step;
    drawSnsIcon(ctx, kind, x, HEIGHT - 46, 20);
    if (count != null) {
      ctx.fillStyle = "#536471";
      ctx.font = `400 14px ${SANS}`;
      ctx.textAlign = "left";
      ctx.fillText(formatCount(count), x + 15, HEIGHT - 44);
    }
  });
}

function drawVertical(ctx, text, options = {}) {
  const maxRows = options.maxRows || 7;
  const maxColumns = options.maxColumns || 6;
  let chars = Array.from(plainText(text).replace(/\s/g, ""));
  const limit = maxRows * maxColumns;
  if (chars.length > limit) chars = chars.slice(0, limit - 1).concat("…");
  if (!chars.length) chars = ["…"];
  const columns = Math.ceil(chars.length / maxRows);
  const fontSize = options.fontSize || 43;
  const rowGap = options.rowGap || 47;
  const columnGap = options.columnGap || 60;
  const centerX = options.centerX ?? WIDTH / 2;
  const centerY = options.centerY ?? HEIGHT / 2;
  const right = centerX + ((columns - 1) * columnGap) / 2;
  const rows = Math.min(maxRows, chars.length);
  const top = centerY - ((rows - 1) * rowGap) / 2;
  const random = randomFor(options.seed || text);
  ctx.save();
  ctx.font = `${options.weight || 600} ${fontSize}px ${options.family || SERIF}`;
  ctx.fillStyle = options.color || "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (options.shadowColor) {
    ctx.shadowColor = options.shadowColor;
    ctx.shadowBlur = options.shadowBlur || 5;
  }
  chars.forEach((char, index) => {
    const column = Math.floor(index / maxRows);
    const row = index % maxRows;
    const jitter = options.jitter || 0;
    const x = right - column * columnGap + (random() - 0.5) * jitter;
    const y = top + row * rowGap + (random() - 0.5) * jitter;
    ctx.fillText(char, x, y);
  });
  ctx.restore();
  return { left: right - (columns - 1) * columnGap - fontSize / 2, bottom: top + (rows - 1) * rowGap + fontSize / 2 };
}

function drawPoem(ctx, text) {
  const paper = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  paper.addColorStop(0, "#f7f4ec");
  paper.addColorStop(0.5, "#fffef9");
  paper.addColorStop(1, "#eee9de");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `poem:${text}`, { alpha: 0.026, specks: 980 });
  const layout = drawVertical(ctx, text, { centerX: WIDTH / 2 + 18, centerY: HEIGHT / 2 - 2, fontSize: 43, jitter: 2.2, seed: `poem:${text}` });
  const x = Math.max(36, layout.left - 46);
  const y = Math.min(HEIGHT - 54, layout.bottom - 16);
  ctx.strokeStyle = "#b71c1c";
  ctx.lineWidth = 2;
  roundedRect(ctx, x - 17, y - 17, 34, 34, 3);
  ctx.stroke();
  ctx.fillStyle = "#b71c1c";
  ctx.font = `800 15px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("詩", x, y);
}

function drawImpact(ctx, text) {
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2 - 4;
  const random = randomFor(`impact:${text}`);
  const count = 210;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.026;
    const inner = 128 + random() * 72;
    const outer = 520 + random() * 230;
    const width = 0.0012 + random() ** 3 * 0.016;
    const yScale = 0.72;
    ctx.fillStyle = `rgba(255,255,255,${0.42 + random() * 0.58})`;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle - width) * inner, cy + Math.sin(angle - width) * inner * yScale);
    ctx.lineTo(cx + Math.cos(angle + width) * inner, cy + Math.sin(angle + width) * inner * yScale);
    ctx.lineTo(cx + Math.cos(angle + width * 0.28) * outer, cy + Math.sin(angle + width * 0.28) * outer * yScale);
    ctx.lineTo(cx + Math.cos(angle - width * 0.28) * outer, cy + Math.sin(angle - width * 0.28) * outer * yScale);
    ctx.closePath();
    ctx.fill();
  }
  const voidGradient = ctx.createRadialGradient(cx, cy, 40, cx, cy, 190);
  voidGradient.addColorStop(0, "rgba(0,0,0,1)");
  voidGradient.addColorStop(0.7, "rgba(0,0,0,0.98)");
  voidGradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = voidGradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawVertical(ctx, text, { centerX: cx, centerY: cy, maxRows: 6, maxColumns: 5, fontSize: 43, columnGap: 50, color: "#fff", weight: 700, shadowColor: "#000", shadowBlur: 7 });
}

function drawIconQuote(ctx, text, profile, avatarImage) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#050506");
  background.addColorStop(0.62, "#0b0c0f");
  background.addColorStop(1, "#17191e");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawAvatar(ctx, profile, avatarImage, WIDTH - 297, HEIGHT / 2 - 141, 286, { grayscale: true });
  const fade = ctx.createLinearGradient(WIDTH - 350, 0, WIDTH - 90, 0);
  fade.addColorStop(0, "rgba(5,5,6,1)");
  fade.addColorStop(0.54, "rgba(5,5,6,0.44)");
  fade.addColorStop(1, "rgba(5,5,6,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(WIDTH - 350, 0, 270, HEIGHT);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.font = `700 72px Georgia, ${SERIF}`;
  ctx.fillText("“", 32, 88);
  drawTextBlock(ctx, text, { family: SERIF, x: 46, align: "left", centerY: HEIGHT / 2 - 22, fontSize: 31, maxWidth: 382, maxLines: 6, color: "#f4f4f3", weight: 500 });
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.moveTo(46, HEIGHT - 78);
  ctx.lineTo(100, HEIGHT - 78);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `700 16px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(profile?.name || "あなた", 46, HEIGHT - 49);
  const width = ctx.measureText(profile?.name || "あなた").width;
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.font = `500 13px ${SANS}`;
  ctx.fillText(profile?.handle || "@you", 56 + width, HEIGHT - 49);
  vignette(ctx, 0.32);
}

function drawUnknown(ctx, commandId, text) {
  ctx.fillStyle = "#16090e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#fb7185";
  roundedRect(ctx, 34, 34, 100, 28, 14);
  ctx.fill();
  ctx.fillStyle = "#2a0e16";
  ctx.font = `800 11px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText("UNKNOWN", 84, 52);
  ctx.fillStyle = "#fecdd3";
  ctx.font = `700 25px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(`@tbot ${commandId}`, 34, 96);
  drawTextBlock(ctx, text || "未登録のコマンド", { fontSize: 40, maxWidth: 580, maxLines: 3, color: "#fff1f2" });
}

async function loadAvatar(url, allowedHosts, timeoutMs = 8_000) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const allowed = [...allowedHosts].some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    );
    if (!allowed) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsed, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) return null;
      const finalUrl = new URL(response.url);
      const finalAllowed = [...allowedHosts].some(
        (host) => finalUrl.hostname === host || finalUrl.hostname.endsWith(`.${host}`),
      );
      if (!finalAllowed) return null;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) return null;
      const maxBytes = 8 * 1024 * 1024;
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks, total);
      return await loadImage(bytes);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function needsByline(commandId) {
  return !new Set(["help", "post", "iconquote", "stamp", "sticker", "gold", "code"]).has(commandId);
}

export async function renderImage({
  commandId,
  text,
  profile,
  post,
  avatarAllowedHosts = new Set(),
  timeZone = "Asia/Tokyo",
  log,
}) {
  registerFonts();
  const canvas = createCanvas(WIDTH * SCALE, HEIGHT * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  const avatarImage = new Set(["post", "iconquote"]).has(commandId)
    ? await loadAvatar(profile?.avatarUrl, avatarAllowedHosts)
    : null;
  if (new Set(["post", "iconquote"]).has(commandId) && profile?.avatarUrl && !avatarImage) {
    let avatarHost = null;
    try {
      avatarHost = new URL(profile.avatarUrl).hostname;
    } catch {
      // The URL normalizer should prevent this; keep the render fallback safe.
    }
    log?.warn?.("avatar_load_failed", {
      command: commandId,
      username: profile?.username || null,
      avatarHost,
    });
  }
  switch (commandId) {
    case "help": drawHelp(ctx); break;
    case "quote": drawQuote(ctx, text); break;
    case "fancy": drawFancy(ctx, text); break;
    case "neon": drawNeon(ctx, text); break;
    case "glitch": drawGlitch(ctx, text); break;
    case "stamp": drawStamp(ctx, text); break;
    case "pixel": drawPixel(ctx, text); break;
    case "banner": drawBanner(ctx, text); break;
    case "speech": drawSpeech(ctx, text); break;
    case "mono": drawMono(ctx, text); break;
    case "rainbow": drawRainbow(ctx, text); break;
    case "sticker": drawSticker(ctx, text); break;
    case "code": drawCode(ctx, text, profile); break;
    case "gold": drawGold(ctx, text); break;
    case "post": drawPost(ctx, text, profile, post, avatarImage, timeZone); break;
    case "poem": drawPoem(ctx, text); break;
    case "impact": drawImpact(ctx, text); break;
    case "iconquote": drawIconQuote(ctx, text, profile, avatarImage); break;
    default: drawUnknown(ctx, commandId, text);
  }
  if (needsByline(commandId)) {
    const dark = new Set(["fancy", "neon", "glitch", "pixel", "rainbow", "impact"]);
    drawByline(ctx, profile, dark.has(commandId) ? "rgba(255,255,255,0.62)" : "rgba(20,20,24,0.48)");
  }
  return canvas.encode("png");
}
