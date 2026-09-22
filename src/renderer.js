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
import { drawRichWithTheme, tokenizeRichText } from "./rich-text.js";

const WIDTH = 720;
const HEIGHT = 420;
const SCALE = 2;
const EMOJI = '"Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji"';
const SANS = `"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", ${EMOJI}, sans-serif`;
const SERIF = `"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", Georgia, ${EMOJI}, serif`;
const MONO = `"Cascadia Mono", Consolas, "Noto Sans JP", "MS Gothic", ${EMOJI}, monospace`;
const BRUSH = `"Yuji Syuku", "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", ${EMOJI}, serif`;
export const RENDERER_FONT_STACKS = Object.freeze({ sans: SANS, serif: SERIF, mono: MONO, brush: BRUSH });
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
const bundledEmoji = fileURLToPath(new URL("../assets/fonts/NotoColorEmoji.ttf", import.meta.url));
const bundledBrush = fileURLToPath(new URL("../assets/fonts/YujiSyuku.ttf", import.meta.url));

function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const candidates = [
    ["Noto Sans JP", process.env.TBOT_FONT_SANS],
    ["Noto Serif JP", process.env.TBOT_FONT_SERIF],
    ["Noto Sans JP", bundledSans],
    ["Noto Serif JP", bundledSerif],
    ["Noto Color Emoji", process.env.TBOT_FONT_EMOJI],
    ["Noto Color Emoji", bundledEmoji],
    ["Yuji Syuku", process.env.TBOT_FONT_BRUSH],
    ["Yuji Syuku", bundledBrush],
    ["Noto Sans JP", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"],
    ["Noto Serif JP", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"],
    ["Yu Gothic UI", "C:\\Windows\\Fonts\\YuGothM.ttc"],
    ["Yu Mincho", "C:\\Windows\\Fonts\\yumin.ttf"],
    ["Segoe UI Emoji", "C:\\Windows\\Fonts\\seguiemj.ttf"],
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

function speechBubblePath(ctx, x, y, width, height, radius, tailX, tailWidth, tailHeight) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(tailX + tailWidth, y + height);
  ctx.lineTo(tailX + tailWidth * 0.42, y + height + tailHeight);
  ctx.lineTo(tailX, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function wrapText(ctx, value, maxWidth) {
  const chars = Array.from(plainText(value));
  const lines = [];
  let current = "";
  for (const char of chars) {
    if (char === "\n") {
      lines.push(current);
      current = "";
      continue;
    }
    const candidate = current + char;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
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
    lines = wrapText(ctx, value, maxWidth);
    const consumed = lines.join("").length;
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

function drawSpark(ctx, x, y, radius, color = "#fff", alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(0.18, color);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, radius * 0.06);
  ctx.beginPath();
  ctx.moveTo(-radius * 1.5, 0);
  ctx.lineTo(radius * 1.5, 0);
  ctx.moveTo(0, -radius * 1.5);
  ctx.lineTo(0, radius * 1.5);
  ctx.stroke();
  ctx.restore();
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
  drawRichWithTheme(ctx, text, {
    theme: "quote", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2 + 8,
    family: SERIF, fontSize: 42, maxWidth: 584, maxLines: 4,
    color: "#201f1c", lineGap: 56, seed: text,
  });
}

function drawFancy(ctx, text) {
  const background = ctx.createLinearGradient(0, HEIGHT, WIDTH, 0);
  background.addColorStop(0, "#11182e");
  background.addColorStop(0.5, "#202348");
  background.addColorStop(1, "#431f45");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const bloomA = ctx.createRadialGradient(WIDTH * 0.18, HEIGHT * 0.18, 0, WIDTH * 0.18, HEIGHT * 0.18, 300);
  bloomA.addColorStop(0, "rgba(81,194,255,0.24)");
  bloomA.addColorStop(1, "rgba(81,194,255,0)");
  ctx.fillStyle = bloomA;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const bloomB = ctx.createRadialGradient(WIDTH * 0.82, HEIGHT * 0.78, 0, WIDTH * 0.82, HEIGHT * 0.78, 300);
  bloomB.addColorStop(0, "rgba(255,121,167,0.2)");
  bloomB.addColorStop(1, "rgba(255,121,167,0)");
  ctx.fillStyle = bloomB;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.translate(WIDTH * 0.82, HEIGHT * 0.5);
  ctx.rotate(0.28);
  ctx.strokeStyle = "rgba(255,225,190,0.18)";
  for (let index = 0; index < 4; index += 1) {
    ctx.lineWidth = index === 0 ? 34 : 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 126 + index * 22, 210 + index * 16, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(58, 54);
  ctx.lineTo(58, HEIGHT - 54);
  ctx.moveTo(58, 54);
  ctx.lineTo(102, 54);
  ctx.stroke();
  drawRichWithTheme(ctx, text, {
    theme: "fancy", mode: "left", cx: 82, centerY: HEIGHT / 2,
    family: SERIF, fontSize: 46, maxWidth: 390, maxLines: 4,
    color: "#fffaf4", lineGap: 58, seed: text,
  });
  vignette(ctx, 0.38);
}

function drawNeon(ctx, text) {
  const background = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0, WIDTH / 2, HEIGHT / 2, 500);
  background.addColorStop(0, "#11152a");
  background.addColorStop(0.58, "#070a15");
  background.addColorStop(1, "#020308");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.filter = "blur(24px)";
  ctx.strokeStyle = "rgba(34,211,238,0.34)";
  ctx.lineWidth = 14;
  roundedRect(ctx, 72, 72, WIDTH - 144, HEIGHT - 144, 54);
  ctx.stroke();
  ctx.strokeStyle = "rgba(56,189,248,0.18)";
  ctx.lineWidth = 9;
  roundedRect(ctx, 82, 82, WIDTH - 164, HEIGHT - 164, 46);
  ctx.stroke();
  ctx.restore();
  const tube = ctx.createLinearGradient(80, 80, WIDTH - 80, HEIGHT - 80);
  tube.addColorStop(0, "#a5f3fc");
  tube.addColorStop(0.45, "#22d3ee");
  tube.addColorStop(0.55, "#38bdf8");
  tube.addColorStop(1, "#bae6fd");
  ctx.strokeStyle = tube;
  ctx.lineWidth = 2.4;
  roundedRect(ctx, 78, 78, WIDTH - 156, HEIGHT - 156, 50);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.46)";
  ctx.lineWidth = 0.8;
  roundedRect(ctx, 82, 82, WIDTH - 164, HEIGHT - 164, 46);
  ctx.stroke();
  drawRichWithTheme(ctx, text, {
    theme: "neon", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    fontSize: 49, maxWidth: 540, maxLines: 3,
    color: "#f8feff", lineGap: 60, seed: text,
  });
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
  drawRichWithTheme(ctx, text, {
    theme: "glitch", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    fontSize: 48, maxWidth: 560, maxLines: 3,
    color: "#f7f7f8", lineGap: 58, seed: text,
  });
  vignette(ctx, 0.35);
}

function drawStamp(ctx, text) {
  const paper = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  paper.addColorStop(0, "#eee7db");
  paper.addColorStop(0.5, "#faf7f0");
  paper.addColorStop(1, "#e9dfd1");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `stamp-v3:${text}`, { alpha: 0.04, specks: 1050 });
  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT / 2);
  ctx.rotate(-0.045);
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "rgba(157,18,35,0.92)";
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.arc(0, 0, 146, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 124, 0, Math.PI * 2);
  ctx.stroke();
  const random = randomFor(`stamp-border:${text}`);
  ctx.fillStyle = "rgba(250,247,240,0.62)";
  for (let index = 0; index < 72; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = (index % 3 === 0 ? 124 : 146) + (random() - 0.5) * 10;
    ctx.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, 1 + random() * 5, 1 + random() * 2.5);
  }
  ctx.restore();
  drawRichWithTheme(ctx, text, {
    theme: "stamp", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    fontSize: 47, maxWidth: 230, maxLines: 3,
    color: "#9d1223", lineGap: 54, seed: text,
  });
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
  drawRichWithTheme(ctx, text, {
    theme: "pixel", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    family: MONO, fontSize: 50, maxWidth: 540, maxLines: 3,
    color: "#fef08a", lineGap: 60, pixelCell: 4, seed: text,
  });
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
  ctx.save();
  ctx.shadowColor = "rgba(20,34,66,0.22)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = band;
  ctx.fillRect(0, 108, WIDTH, 204);
  ctx.restore();
  ctx.fillStyle = "#f05a35";
  ctx.fillRect(0, 98, WIDTH, 10);
  ctx.fillRect(0, 312, WIDTH, 10);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(0, 108, WIDTH, 1);
  drawRichWithTheme(ctx, text, {
    theme: "banner", mode: "left", cx: 70, centerY: HEIGHT / 2,
    fontSize: 45, maxWidth: 580, maxLines: 3,
    color: "#fffaf2", lineGap: 54, seed: text,
  });
}

function drawSpeech(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#dfeafc");
  background.addColorStop(1, "#eee7fa");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const light = ctx.createRadialGradient(WIDTH * 0.78, HEIGHT * 0.18, 0, WIDTH * 0.78, HEIGHT * 0.18, 280);
  light.addColorStop(0, "rgba(255,255,255,0.55)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const visibleLength = Array.from(String(text || "").replace(/[*_`$#~]/g, "")).length;
  const compact = visibleLength <= 12;
  const width = compact ? 520 : WIDTH - 128;
  const height = compact ? 210 : 264;
  const x = (WIDTH - width) / 2;
  const y = compact ? 76 : 58;
  const tailX = x + 96;
  const tailWidth = 48;
  const tailHeight = 40;
  ctx.save();
  ctx.shadowColor = "rgba(55,65,115,0.2)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fff";
  speechBubblePath(ctx, x, y, width, height, 38, tailX, tailWidth, tailHeight);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#5964c9";
  ctx.lineWidth = 3.5;
  speechBubblePath(ctx, x, y, width, height, 38, tailX, tailWidth, tailHeight);
  ctx.stroke();
  drawRichWithTheme(ctx, text, {
    theme: "speech", mode: "center", cx: x + width / 2, centerY: y + height / 2,
    fontSize: compact ? 46 : 42, maxWidth: width - 112, maxLines: 4,
    color: "#172033", lineGap: 48, seed: text,
  });
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
  drawRichWithTheme(ctx, text, {
    theme: "mono", mode: "left", cx: 168, centerY: HEIGHT / 2,
    family: SERIF, fontSize: 43, maxWidth: 490, maxLines: 4,
    color: "#0c0c0c", lineGap: 52, seed: text,
  });
}

function drawRainbow(ctx, text) {
  const rainbow = ["#ff0033", "#ff6600", "#ffcc00", "#33ff66", "#00ccff", "#3366ff", "#cc33ff"];
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  rainbow.forEach((color, index) => background.addColorStop(index / (rainbow.length - 1), color));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const shade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  shade.addColorStop(0, "rgba(20,16,34,0.08)");
  shade.addColorStop(0.5, "rgba(20,16,34,0.2)");
  shade.addColorStop(1, "rgba(20,16,34,0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawRichWithTheme(ctx, text, {
    theme: "rainbow", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    fontSize: 50, maxWidth: 570, maxLines: 3,
    color: "#ffffff", lineGap: 56, seed: text,
  });
}

function drawSticker(ctx, text) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#d8f0ed");
  background.addColorStop(0.52, "#e8e2f6");
  background.addColorStop(1, "#f6dfdc");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 20, WIDTH / 2, HEIGHT / 2, 300);
  glow.addColorStop(0, "rgba(255,255,255,0.72)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `sticker-v3:${text}`, { color: "40,50,70", alpha: 0.014, specks: 380 });
  drawRichWithTheme(ctx, text, {
    theme: "sticker", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2,
    fontSize: 50, maxWidth: 570, maxLines: 3,
    color: "#ff5368", lineGap: 58, seed: text,
  });
}

function drawCode(ctx, text, profile) {
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const username = String(profile?.handle || "@you").replace(/^@/, "") || "you";
  const prompt = `C:\\Users\\${username}>`;
  ctx.fillStyle = "#f2f2f2";
  ctx.textAlign = "left";
  const value = `${prompt}${plainText(text)}`;
  const maxWidth = WIDTH - 64;
  const maxHeight = HEIGHT - 64;
  const requestedSize = 25;
  const minFontSize = 12;
  const lineHeightRatio = 37 / requestedSize;
  let fontSize = requestedSize;
  let lineHeight = fontSize * lineHeightRatio;
  let lines;
  while (fontSize >= minFontSize) {
    ctx.font = `400 ${fontSize}px ${MONO}`;
    lines = wrapText(ctx, value, maxWidth);
    lineHeight = fontSize * lineHeightRatio;
    if (lines.length * lineHeight <= maxHeight || fontSize === minFontSize) break;
    fontSize -= 1;
  }
  const firstY = (HEIGHT - lines.length * lineHeight) / 2 + fontSize;
  lines.forEach((line, index) => ctx.fillText(line, 32, firstY + index * lineHeight));
}

function drawGold(ctx, text) {
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  base.addColorStop(0, "#5b3307");
  base.addColorStop(0.24, "#bd7a13");
  base.addColorStop(0.5, "#f0c75a");
  base.addColorStop(0.72, "#a8630b");
  base.addColorStop(1, "#4b2805");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const liquidTop = ctx.createLinearGradient(0, 0, WIDTH, 0);
  liquidTop.addColorStop(0, "rgba(255,239,171,0.04)");
  liquidTop.addColorStop(0.45, "rgba(255,250,211,0.62)");
  liquidTop.addColorStop(1, "rgba(255,207,92,0.05)");
  ctx.fillStyle = liquidTop;
  ctx.beginPath();
  ctx.moveTo(-30, 80);
  ctx.bezierCurveTo(WIDTH * 0.2, 8, WIDTH * 0.32, 190, WIDTH * 0.58, 92);
  ctx.bezierCurveTo(WIDTH * 0.78, 20, WIDTH * 0.88, 110, WIDTH + 30, 42);
  ctx.lineTo(WIDTH + 30, 128);
  ctx.bezierCurveTo(WIDTH * 0.82, 196, WIDTH * 0.7, 102, WIDTH * 0.54, 170);
  ctx.bezierCurveTo(WIDTH * 0.3, 252, WIDTH * 0.18, 86, -30, 160);
  ctx.closePath();
  ctx.fill();

  const liquidBottom = ctx.createLinearGradient(0, HEIGHT, WIDTH, 0);
  liquidBottom.addColorStop(0, "rgba(102,52,4,0.28)");
  liquidBottom.addColorStop(0.48, "rgba(255,234,151,0.34)");
  liquidBottom.addColorStop(1, "rgba(102,52,4,0.22)");
  ctx.fillStyle = liquidBottom;
  ctx.beginPath();
  ctx.moveTo(-20, HEIGHT - 82);
  ctx.bezierCurveTo(WIDTH * 0.2, HEIGHT - 180, WIDTH * 0.42, HEIGHT - 30, WIDTH * 0.62, HEIGHT - 116);
  ctx.bezierCurveTo(WIDTH * 0.82, HEIGHT - 198, WIDTH * 0.9, HEIGHT - 62, WIDTH + 20, HEIGHT - 146);
  ctx.lineTo(WIDTH + 20, HEIGHT + 20);
  ctx.lineTo(-20, HEIGHT + 20);
  ctx.closePath();
  ctx.fill();

  const focus = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 230);
  focus.addColorStop(0, "rgba(255,253,230,0.74)");
  focus.addColorStop(0.4, "rgba(255,230,137,0.22)");
  focus.addColorStop(1, "rgba(153,88,6,0)");
  ctx.fillStyle = focus;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const random = randomFor(`gold-v3:${text}`);
  for (let index = 0; index < 16; index += 1) {
    drawSpark(
      ctx,
      38 + random() * (WIDTH - 76),
      36 + random() * (HEIGHT - 72),
      3 + random() * 5,
      "#fffbe5",
      0.3 + random() * 0.45,
    );
  }
  drawRichWithTheme(ctx, text, {
    theme: "gold", mode: "center", cx: centerX, centerY,
    fontSize: 49, maxWidth: WIDTH - 100, maxLines: 3,
    color: "#fff8d0", lineGap: 58, seed: text,
  });

  const edge = ctx.createRadialGradient(centerX, centerY, 120, centerX, centerY, WIDTH * 0.7);
  edge.addColorStop(0, "rgba(91,46,4,0)");
  edge.addColorStop(0.72, "rgba(91,46,4,0.06)");
  edge.addColorStop(1, "rgba(78,38,3,0.42)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
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
  drawRichWithTheme(ctx, text, {
    theme: "post", mode: "left", cx: 44, topY: 128,
    fontSize: 28, maxWidth: WIDTH - 88, maxLines: Number.POSITIVE_INFINITY,
    color: "#0f1419", lineGap: 40, seed: text, adaptive: false,
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

const verticalSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const verticalEmojiPattern = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function verticalRichGlyphs(value) {
  return tokenizeRichText(value).flatMap((run) => {
    if (run.math) return [{ ...run, glyph: run.text }];
    return Array.from(verticalSegmenter.segment(run.text), ({ segment }) => segment)
      .filter((segment) => !/^\s+$/u.test(segment))
      .map((glyph) => ({ ...run, glyph }));
  });
}

function drawVertical(ctx, text, options = {}) {
  const requestedRows = options.maxRows || 7;
  let glyphs = verticalRichGlyphs(text);
  if (!glyphs.length) glyphs = [{ glyph: "", size: 1 }];
  const requestedSize = options.fontSize || 43;
  const requestedRowGap = options.rowGap || 47;
  const requestedColumnGap = options.columnGap || 60;
  const fitScale = options.adaptiveFitScale || 1.06;
  const fitWidth = (options.fitWidth || WIDTH - 96) * fitScale;
  const fitHeight = (options.fitHeight || HEIGHT - 80) * fitScale;
  const minFontSize = Math.min(requestedSize, options.minFontSize || 12);
  const dimensions = (fontSize, rows) => {
    const scale = fontSize / requestedSize;
    const rowGap = requestedRowGap * scale;
    const columnGap = requestedColumnGap * scale;
    const columns = Math.ceil(glyphs.length / rows);
    const usedRows = Math.min(rows, glyphs.length);
    return {
      fontSize,
      rows,
      columns,
      rowGap,
      columnGap,
      width: Math.max(fontSize, (columns - 1) * columnGap + fontSize),
      height: Math.max(fontSize, (usedRows - 1) * rowGap + fontSize),
    };
  };
  let layout = dimensions(requestedSize, requestedRows);
  if (layout.width > fitWidth || layout.height > fitHeight) {
    const adaptiveLayout = (fontSize) => {
      const scale = fontSize / requestedSize;
      const rowGap = requestedRowGap * scale;
      const rowsByHeight = Math.max(1, Math.floor((fitHeight - fontSize) / rowGap) + 1);
      return dimensions(fontSize, Math.max(requestedRows, rowsByHeight));
    };
    for (let fontSize = requestedSize - 1; fontSize >= minFontSize; fontSize -= 1) {
      layout = adaptiveLayout(fontSize);
      if (layout.width <= fitWidth && layout.height <= fitHeight) break;
    }
    if (layout.fontSize < requestedSize) {
      const slightlyLarger = adaptiveLayout(layout.fontSize + 1);
      if (slightlyLarger.width <= fitWidth * 1.08 && slightlyLarger.height <= fitHeight * 1.08) {
        layout = slightlyLarger;
      }
    }
  }
  const {
    rows: maxRows,
    columns,
    fontSize,
    rowGap,
    columnGap,
  } = layout;
  const centerX = options.centerX ?? WIDTH / 2;
  const centerY = options.centerY ?? HEIGHT / 2;
  const right = centerX + ((columns - 1) * columnGap) / 2;
  const rows = Math.min(maxRows, glyphs.length);
  const top = centerY - ((rows - 1) * rowGap) / 2;
  const random = randomFor(options.seed || text);
  const columnOffsets = Array.from(
    { length: columns },
    () => (random() - 0.5) * (options.columnJitter || 0),
  );
  ctx.save();
  ctx.fillStyle = options.color || "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (options.shadowColor) {
    ctx.shadowColor = options.shadowColor;
    ctx.shadowBlur = options.shadowBlur || 5;
  }
  glyphs.forEach((glyph, index) => {
    const column = Math.floor(index / maxRows);
    const row = index % maxRows;
    const jitter = options.jitter || 0;
    const x = right - column * columnGap + (random() - 0.5) * jitter;
    const y = top + row * rowGap + columnOffsets[column] + (random() - 0.5) * jitter;
    const sizeJitter = options.sizeJitter || 0;
    const glyphSize = fontSize * (glyph.size || 1) * (1 + (random() - 0.5) * sizeJitter);
    const rotation = verticalGlyphRotation(glyph.glyph) + (random() - 0.5) * (options.rotationJitter || 0);
    ctx.save();
    ctx.fillStyle = glyph.color || options.color || "#111";
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (glyph.math) {
      ctx.restore();
      drawRichWithTheme(ctx, `\\(${glyph.glyph}\\)`, {
        theme: "plain", mode: "center", cx: x, centerY: y,
        fontSize: Math.max(12, Math.round(fontSize * 0.65)),
        maxWidth: Math.min(240, columnGap * 3), maxLines: 1,
        adaptive: false, color: options.color || "#111",
      });
      return;
    }
    const emoji = verticalEmojiPattern.test(glyph.glyph);
    const weight = glyph.bold ? Math.max(900, options.weight || 600) : options.weight || 600;
    ctx.font = `${glyph.italic ? "italic " : ""}${weight} ${glyphSize}px ${glyph.code ? MONO : options.family || SERIF}`;
    if (glyph.italic && emoji) ctx.transform(1, 0, -0.2, 1, 0, 0);
    if (glyph.bold && emoji) {
      const offset = Math.max(0.8, Math.round(glyphSize * 0.025));
      for (const [dx, dy] of [[-offset, 0], [offset, 0], [0, -offset], [0, offset]]) {
        ctx.fillText(glyph.glyph, dx, dy);
      }
    }
    ctx.fillText(glyph.glyph, 0, 0);
    if (glyph.strike) {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1.5, glyphSize * 0.055);
      ctx.beginPath();
      ctx.moveTo(-glyphSize * 0.45, 0);
      ctx.lineTo(glyphSize * 0.45, 0);
      ctx.stroke();
    }
    if (options.inkTexture) {
      ctx.globalAlpha = 0.16;
      ctx.fillText(glyph.glyph, (random() - 0.5) * 1.2, (random() - 0.5) * 1.2);
    }
    ctx.restore();
  });
  ctx.restore();
  return {
    left: right - (columns - 1) * columnGap - fontSize / 2,
    bottom: top + (rows - 1) * rowGap + fontSize / 2 + (options.columnJitter || 0) / 2,
  };
}

const VERTICAL_ROTATED_GLYPHS = new Set(["ー", "ｰ", "―", "—", "–", "−"]);

export function verticalGlyphRotation(character) {
  return VERTICAL_ROTATED_GLYPHS.has(character) ? Math.PI / 2 : 0;
}

function drawPoem(ctx, text) {
  const paper = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  paper.addColorStop(0, "#f7f3e9");
  paper.addColorStop(0.48, "#fffefa");
  paper.addColorStop(1, "#f0eadf");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  paperTexture(ctx, `poem:${text}`, { alpha: 0.022, specks: 760 });
  const length = verticalRichGlyphs(text).length;
  const short = length <= 30;
  const fontSize = 43;
  const maxRows = short
    ? Math.max(3, Math.min(5, Math.ceil(Math.sqrt(Math.max(1, length)))))
    : 7;
  const layout = drawVertical(ctx, text, {
    centerX: WIDTH / 2 + 20,
    centerY: HEIGHT / 2 - 8,
    maxRows,
    fontSize,
    rowGap: fontSize * 1.04,
    columnGap: fontSize * 1.46,
    fitWidth: WIDTH - 126,
    fitHeight: HEIGHT - 110,
    family: BRUSH,
    weight: 400,
    color: "#11100e",
    jitter: short ? 8 : 2.5,
    columnJitter: short ? 28 : 5,
    sizeJitter: short ? 0.3 : 0.08,
    rotationJitter: short ? 0.1 : 0.025,
    inkTexture: true,
    seed: `poem:${text}`,
  });
  const x = Math.max(40, layout.left - (short ? 54 : 38));
  const y = Math.min(HEIGHT - 58, layout.bottom - (short ? 8 : 14));
  ctx.strokeStyle = "#b71c1c";
  ctx.lineWidth = 2.2;
  roundedRect(ctx, x - 17, y - 17, 34, 34, 2);
  ctx.stroke();
  ctx.fillStyle = "#b71c1c";
  ctx.font = `400 17px ${BRUSH}`;
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
  drawRichWithTheme(ctx, text, {
    theme: "plain", mode: "left", cx: 46, centerY: HEIGHT / 2 - 22,
    family: SERIF, fontSize: 31, maxWidth: 382, maxLines: 6,
    color: "#f4f4f3", lineGap: 43, seed: text,
  });
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
  drawRichWithTheme(ctx, text || "未登録のコマンド", {
    theme: "plain", mode: "center", cx: WIDTH / 2, centerY: HEIGHT / 2 + 24,
    fontSize: 40, maxWidth: 580, maxLines: 3,
    color: "#fff1f2", lineGap: 52, seed: text,
  });
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
