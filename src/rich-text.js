import { createCanvas } from "@napi-rs/canvas";

const EMOJI_FAMILY = '"Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji"';
const DEFAULT_FAMILY = `"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", ${EMOJI_FAMILY}, sans-serif`;
const CODE_FAMILY = `"Cascadia Mono", Consolas, "MS Gothic", ${EMOJI_FAMILY}, monospace`;
const MATH_FAMILY = `"Cambria Math", "Times New Roman", "Yu Mincho", "Noto Serif JP", ${EMOJI_FAMILY}, serif`;

const MATH_GREEK = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ",
  psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const MATH_SYMBOLS = {
  times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡",
  infty: "∞", in: "∈", notin: "∉", subset: "⊂", supset: "⊃",
  forall: "∀", exists: "∃", emptyset: "∅", nabla: "∇",
  rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", leftrightarrow: "↔",
  sum: "∑", prod: "∏", int: "∫", partial: "∂",
  ldots: "…", dots: "…", to: "→", mapsto: "↦",
};

function readMathGroup(source, index) {
  let cursor = index;
  while (cursor < source.length && source[cursor] === " ") cursor += 1;
  if (cursor >= source.length) return { body: "", next: cursor };
  if (source[cursor] === "{") {
    let depth = 0;
    for (let end = cursor; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) return { body: source.slice(cursor + 1, end), next: end + 1 };
      }
    }
    return { body: source.slice(cursor + 1), next: source.length };
  }
  if (source[cursor] === "\\") {
    const [, next] = parseMathToken(source, cursor);
    return { body: source.slice(cursor, next), next };
  }
  return { body: source[cursor], next: cursor + 1 };
}

function parseMathToken(source, index) {
  if (index >= source.length) return [null, index];
  if (source[index] === "\\") {
    let cursor = index + 1;
    let name = "";
    while (cursor < source.length && /[a-zA-Z]/.test(source[cursor])) {
      name += source[cursor];
      cursor += 1;
    }
    if (!name) return [{ type: "char", ch: source[index + 1] || "", style: "up" }, index + 2];
    if (["frac", "dfrac", "tfrac"].includes(name)) {
      const numerator = readMathGroup(source, cursor);
      const denominator = readMathGroup(source, numerator.next);
      return [{ type: "frac", num: numerator.body, den: denominator.body }, denominator.next];
    }
    if (name === "sqrt") {
      const group = readMathGroup(source, cursor);
      return [{ type: "sqrt", body: group.body }, group.next];
    }
    if (name === "color" || name === "textcolor") {
      const colorGroup = readMathGroup(source, cursor);
      const bodyStart = colorGroup.next;
      const groupedBody = readMathGroup(source, bodyStart);
      const hasExplicitBody = source.slice(bodyStart).trimStart().startsWith("{");
      const body = hasExplicitBody ? groupedBody.body : source.slice(bodyStart).trim();
      const next = hasExplicitBody ? groupedBody.next : source.length;
      return [{ type: "color", color: safeMathColor(colorGroup.body), body }, next];
    }
    if (["text", "mathrm", "operatorname"].includes(name)) {
      const group = readMathGroup(source, cursor);
      return [{ type: "text", body: group.body, bold: false }, group.next];
    }
    if (name === "mathbf") {
      const group = readMathGroup(source, cursor);
      return [{ type: "text", body: group.body, bold: true }, group.next];
    }
    if (MATH_GREEK[name]) return [{ type: "char", ch: MATH_GREEK[name], style: "up" }, cursor];
    if (MATH_SYMBOLS[name]) return [{ type: "char", ch: MATH_SYMBOLS[name], style: "op" }, cursor];
    return [{ type: "char", ch: name, style: "up" }, cursor];
  }
  if (source[index] === "^" || source[index] === "_") {
    const group = readMathGroup(source, index + 1);
    return [{ type: source[index] === "^" ? "sup" : "sub", body: group.body }, group.next];
  }
  if (source[index] === "{" || source[index] === "}") {
    return [{ type: "char", ch: "", style: "up" }, index + 1];
  }
  const style = /[A-Za-z]/.test(source[index]) ? "italic" : /[0-9]/.test(source[index]) ? "num" : "op";
  return [{ type: "char", ch: source[index], style }, index + 1];
}

function safeMathColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  const named = new Set([
    "black", "white", "red", "orange", "yellow", "green", "blue", "purple", "pink",
    "gray", "grey", "cyan", "magenta", "brown", "teal", "navy", "lime",
  ]);
  return named.has(color.toLowerCase()) ? color.toLowerCase() : "#0f1419";
}

export function parseMathExpression(value) {
  const source = String(value || "");
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const [token, next] = parseMathToken(source, index);
    if (!token) break;
    if (token.type !== "char" || token.ch) tokens.push(token);
    index = next;
  }
  return tokens;
}

export function tokenizeRichText(value) {
  const source = String(value || "")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<(?:del|s)>([\s\S]*?)<\/(?:del|s)>/gi, "~~$1~~")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  const runs = [];
  let buffer = "";
  let style = { bold: false, italic: false, code: false, math: false, color: null, size: 1 };
  const push = () => {
    if (!buffer) return;
    runs.push({ text: buffer, ...style });
    buffer = "";
  };
  const setStyle = (patch) => {
    push();
    style = { ...style, ...patch };
  };

  let index = 0;
  while (index < source.length) {
    if (source.startsWith("\\[", index)) {
      const end = source.indexOf("\\]", index + 2);
      if (end >= 0) {
        push();
        runs.push({ text: source.slice(index + 2, end).trim(), math: true, block: true, bold: false, italic: false, code: false, color: null, size: 1.05 });
        index = end + 2;
        continue;
      }
    }
    if (source.startsWith("\\(", index)) {
      const end = source.indexOf("\\)", index + 2);
      if (end >= 0) {
        push();
        runs.push({ text: source.slice(index + 2, end).trim(), math: true, block: false, bold: false, italic: false, code: false, color: null, size: 1 });
        index = end + 2;
        continue;
      }
    }
    if (source.startsWith("$$", index)) {
      const end = source.indexOf("$$", index + 2);
      if (end >= 0) {
        push();
        if (runs.length && !String(runs.at(-1)?.text || "").endsWith("\n")) {
          runs.push({ text: "\n", ...style });
        }
        runs.push({ text: source.slice(index + 2, end), math: true, block: true, bold: false, italic: false, code: false, color: null, size: 1.05 });
        runs.push({ text: "\n", ...style });
        index = end + 2;
        continue;
      }
    }
    if (source[index] === "$" && source[index + 1] !== "$") {
      const end = source.indexOf("$", index + 1);
      if (end > index + 1) {
        const body = source.slice(index + 1, end).trim();
        if (!body.includes("\n")) {
          push();
          runs.push({ text: body, math: true, block: false, bold: false, italic: false, code: false, color: null, size: 1 });
          index = end + 1;
          continue;
        }
      }
    }
    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end > index) {
        push();
        runs.push({ text: source.slice(index + 1, end), code: true, bold: false, italic: false, math: false, color: "#f97316", size: 0.92 });
        index = end + 1;
        continue;
      }
    }
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const mark = source.slice(index, index + 2);
      const end = source.indexOf(mark, index + 2);
      if (end > index + 2) {
        setStyle({ bold: true });
        buffer += source.slice(index + 2, end);
        push();
        style = { ...style, bold: false };
        index = end + 2;
        continue;
      }
    }
    if (source.startsWith("~~", index)) {
      const end = source.indexOf("~~", index + 2);
      if (end > index + 2) {
        push();
        runs.push({ text: source.slice(index + 2, end), strike: true, bold: false, italic: false, code: false, math: false, color: "#9ca3af", size: 1 });
        index = end + 2;
        continue;
      }
    }
    if (source[index] === "~" && source[index + 1] !== "~") {
      const end = source.indexOf("~", index + 1);
      if (end > index + 1) {
        push();
        runs.push({ text: source.slice(index + 1, end), strike: true, bold: false, italic: false, code: false, math: false, color: "#9ca3af", size: 1 });
        index = end + 1;
        continue;
      }
    }
    if ((source[index] === "*" || source[index] === "_") && !/\s/.test(source[index + 1] || "")) {
      const end = source.indexOf(source[index], index + 1);
      if (end > index + 1) {
        setStyle({ italic: true });
        buffer += source.slice(index + 1, end);
        push();
        style = { ...style, italic: false };
        index = end + 1;
        continue;
      }
    }
    if ((index === 0 || source[index - 1] === "\n") && source[index] === "#") {
      let level = 0;
      while (source[index] === "#") {
        level += 1;
        index += 1;
      }
      if (source[index] === " ") index += 1;
      const end = source.indexOf("\n", index);
      const lineEnd = end >= 0 ? end : source.length;
      setStyle({ bold: true, size: level === 1 ? 1.25 : level === 2 ? 1.12 : 1.05 });
      buffer += source.slice(index, lineEnd);
      push();
      style = { bold: false, italic: false, code: false, math: false, color: null, size: 1 };
      index = lineEnd;
      continue;
    }
    if (source[index] === "[") {
      const close = source.indexOf("](", index);
      const end = close >= 0 ? source.indexOf(")", close + 2) : -1;
      if (end > close) {
        push();
        runs.push({ text: source.slice(index + 1, close), link: true, bold: false, italic: false, code: false, math: false, color: "#38bdf8", size: 1 });
        index = end + 1;
        continue;
      }
    }
    buffer += source[index];
    index += 1;
  }
  push();
  return runs.length ? runs : [{ text: "", ...style }];
}

function richFontFor(run, baseSize, family) {
  const size = Math.round(baseSize * (run.size || 1));
  if (run.code) return `600 ${Math.round(size * 0.92)}px ${CODE_FAMILY}`;
  if (run.math) return `500 ${size}px ${MATH_FAMILY}`;
  return `${run.italic ? "italic " : ""}${run.bold ? 900 : 700} ${size}px ${family || DEFAULT_FAMILY}`;
}

function measureMath(ctx, tokens, size) {
  let width = 0;
  let height = size * 1.2;
  for (const token of tokens) {
    if (token.type === "char") {
      ctx.font = `${token.style === "italic" ? "italic " : ""}600 ${size}px ${MATH_FAMILY}`;
      width += ctx.measureText(token.ch).width;
    } else if (token.type === "text") {
      ctx.font = `${token.bold ? 700 : 500} ${size}px ${DEFAULT_FAMILY}`;
      width += ctx.measureText(token.body).width;
    } else if (token.type === "color") {
      const measured = measureMath(ctx, parseMathExpression(token.body), size);
      width += measured.width;
      height = Math.max(height, measured.height);
    } else if (token.type === "sup" || token.type === "sub") {
      const measured = measureMath(ctx, parseMathExpression(token.body), size * 0.7);
      width += measured.width + 2;
    } else if (token.type === "frac") {
      const numerator = measureMath(ctx, parseMathExpression(token.num), size * 0.72);
      const denominator = measureMath(ctx, parseMathExpression(token.den), size * 0.72);
      width += Math.max(numerator.width, denominator.width) + 12;
      height = Math.max(height, size * 2.1);
    } else if (token.type === "sqrt") {
      width += measureMath(ctx, parseMathExpression(token.body), size).width + 20;
    }
  }
  return { width, height };
}

function drawMathTokens(ctx, tokens, x, y, size, color) {
  let cursor = x;
  for (const token of tokens) {
    ctx.fillStyle = color;
    if (token.type === "char") {
      ctx.font = `${token.style === "italic" ? "italic " : ""}600 ${size}px ${MATH_FAMILY}`;
      ctx.fillText(token.ch, cursor, y);
      cursor += ctx.measureText(token.ch).width;
    } else if (token.type === "text") {
      ctx.font = `${token.bold ? 700 : 500} ${size}px ${DEFAULT_FAMILY}`;
      ctx.fillText(token.body, cursor, y);
      cursor += ctx.measureText(token.body).width;
    } else if (token.type === "color") {
      cursor += drawMathTokens(ctx, parseMathExpression(token.body), cursor, y, size, token.color || color);
    } else if (token.type === "sup" || token.type === "sub") {
      const inner = parseMathExpression(token.body);
      const subSize = size * 0.7;
      drawMathTokens(ctx, inner, cursor, y + (token.type === "sup" ? -size * 0.38 : size * 0.28), subSize, color);
      cursor += measureMath(ctx, inner, subSize).width + 2;
    } else if (token.type === "frac") {
      const numerator = parseMathExpression(token.num);
      const denominator = parseMathExpression(token.den);
      const numeratorSize = size * 0.72;
      const numeratorMetrics = measureMath(ctx, numerator, numeratorSize);
      const denominatorMetrics = measureMath(ctx, denominator, numeratorSize);
      const fractionWidth = Math.max(numeratorMetrics.width, denominatorMetrics.width) + 8;
      drawMathTokens(ctx, numerator, cursor + (fractionWidth - numeratorMetrics.width) / 2, y - size * 0.42, numeratorSize, color);
      drawMathTokens(ctx, denominator, cursor + (fractionWidth - denominatorMetrics.width) / 2, y + size * 0.48, numeratorSize, color);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(cursor, y - size * 0.05);
      ctx.lineTo(cursor + fractionWidth, y - size * 0.05);
      ctx.stroke();
      cursor += fractionWidth + 4;
    } else if (token.type === "sqrt") {
      const inner = parseMathExpression(token.body);
      const innerMetrics = measureMath(ctx, inner, size);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.4, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(cursor, y + size * 0.1);
      ctx.lineTo(cursor + 5, y + size * 0.1);
      ctx.lineTo(cursor + 9, y - size * 0.45);
      ctx.lineTo(cursor + 13, y + size * 0.35);
      ctx.lineTo(cursor + 16 + innerMetrics.width, y + size * 0.35);
      ctx.stroke();
      drawMathTokens(ctx, inner, cursor + 16, y, size, color);
      cursor += innerMetrics.width + 20;
    }
  }
  return cursor - x;
}

function measureRun(ctx, run, baseSize, family) {
  if (run.math) {
    return measureMath(ctx, parseMathExpression(run.text), baseSize * (run.size || 1) * (run.block ? 1.05 : 1));
  }
  ctx.font = richFontFor(run, baseSize, family);
  return { width: ctx.measureText(run.text).width, height: baseSize * 1.25 * (run.size || 1) };
}

function drawRun(ctx, run, x, y, baseSize, family, defaultColor) {
  const color = run.color || defaultColor;
  if (run.math) return drawMathTokens(ctx, parseMathExpression(run.text), x, y, baseSize * (run.size || 1), color);
  ctx.font = richFontFor(run, baseSize, family);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(run.text, x, y);
  const metrics = ctx.measureText(run.text);
  const width = metrics.width;
  if (run.strike) {
    const glyphCenter = y + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, baseSize * 0.055);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, glyphCenter);
    ctx.lineTo(x + width, glyphCenter);
    ctx.stroke();
  }
  return width;
}

export function wrapRichRuns(ctx, runs, maxWidth, baseSize, family) {
  const lines = [];
  let line = [];
  let lineWidth = 0;
  const pushLine = (force = false) => {
    if (line.length || force) lines.push(line);
    line = [];
    lineWidth = 0;
  };
  for (const run of runs) {
    if (run.math) {
      const runWidth = measureRun(ctx, run, baseSize, family).width;
      if (line.length && lineWidth + runWidth > maxWidth) pushLine();
      line.push(run);
      lineWidth += runWidth;
      continue;
    }
    for (const piece of String(run.text || "").split(/(\n)/)) {
      if (piece === "\n") {
        pushLine(true);
        continue;
      }
      if (!piece) continue;
      let chunk = "";
      for (const character of Array.from(piece)) {
        const candidate = chunk + character;
        const candidateWidth = measureRun(ctx, { ...run, text: candidate }, baseSize, family).width;
        if (lineWidth + candidateWidth > maxWidth && (chunk || line.length)) {
          if (chunk) line.push({ ...run, text: chunk });
          pushLine();
          chunk = character;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) {
        line.push({ ...run, text: chunk });
        lineWidth += measureRun(ctx, { ...run, text: chunk }, baseSize, family).width;
      }
    }
  }
  if (line.length) pushLine();
  if (!lines.length) lines.push([{ text: "", bold: false, size: 1 }]);
  return lines;
}

function tintCanvas(source, fillStyle) {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = fillStyle;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function gradientTintCanvas(source, stops, horizontal = false) {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  const gradient = horizontal
    ? ctx.createLinearGradient(0, 0, source.width, 0)
    : ctx.createLinearGradient(0, 0, 0, source.height);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, source.width, source.height);
  return canvas;
}

function effectSeed(value) {
  let result = 2166136261;
  for (const char of String(value || "tbot")) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function effectRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distressCanvas(source, seed, strength = 0.0012) {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  const random = effectRandom(effectSeed(seed));
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  const count = Math.round(source.width * source.height * strength);
  for (let index = 0; index < count; index += 1) {
    ctx.globalAlpha = 0.25 + random() * 0.7;
    ctx.fillRect(random() * source.width, random() * source.height, 0.7 + random() * 3.2, 0.7 + random() * (random() > 0.75 ? 8 : 2));
  }
  return canvas;
}

function pixelateCanvas(source, cell = 6) {
  const size = Math.max(2, cell);
  const columns = Math.max(1, Math.ceil(source.width / size));
  const rows = Math.max(1, Math.ceil(source.height / size));
  const small = createCanvas(columns, rows);
  const smallCtx = small.getContext("2d");
  smallCtx.drawImage(source, 0, 0, columns, rows);
  const image = smallCtx.getImageData(0, 0, columns, rows);
  for (let index = 0; index < image.data.length; index += 4) image.data[index + 3] = image.data[index + 3] > 44 ? 255 : 0;
  smallCtx.putImageData(image, 0, 0);
  const large = createCanvas(columns * size, rows * size);
  const largeCtx = large.getContext("2d");
  largeCtx.imageSmoothingEnabled = false;
  largeCtx.drawImage(small, 0, 0, large.width, large.height);
  return large;
}

function drawMaskOutline(ctx, source, x, y, radius, color, steps = 20, alpha = 1) {
  const mask = tintCanvas(source, color);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    ctx.drawImage(mask, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.restore();
}

function drawSoftMask(ctx, source, x, y, color, blur, alpha = 1, offsetX = 0, offsetY = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0, blur);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.drawImage(tintCanvas(source, color), x + offsetX, y + offsetY);
  ctx.restore();
}

function cropAlphaBounds(canvas) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return canvas;
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const output = createCanvas(width, height);
  output.getContext("2d").drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
  return output;
}

function hasDecoration(runs) {
  return runs.some((run) => run.math || run.code || run.bold || run.italic || run.strike || run.link || (run.size && run.size !== 1));
}

function blitThemeEffect(ctx, source, theme, x, y, options) {
  const tint = (color) => tintCanvas(source, color);
  const seed = effectSeed(`${theme}:${options.seed || "text"}:${source.width}x${source.height}`);
  const random = effectRandom(seed);
  ctx.save();
  if (theme === "neon") {
    drawSoftMask(ctx, source, x, y, "#22d3ee", 22, 0.36);
    drawSoftMask(ctx, source, x, y, "#38bdf8", 8, 0.4);
    drawMaskOutline(ctx, source, x, y, 1.5, "#fbfdff", 18, 0.9);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(gradientTintCanvas(source, [[0, "#ffffff"], [0.48, "#a5f3fc"], [1, "#ffffff"]], true), x, y);
    if (options.hasExplicitColors) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.82;
      ctx.drawImage(source, x, y);
    }
  } else if (theme === "gold") {
    drawSoftMask(ctx, source, x, y, "#ffca3a", 18, 0.34, 0, 4);
    drawMaskOutline(ctx, source, x + 5, y + 6, 4, "#5a2f00", 28, 0.76);
    for (let depth = 6; depth >= 1; depth -= 1) {
      ctx.globalAlpha = 0.96;
      ctx.drawImage(tint(depth > 4 ? "#4b2700" : depth > 2 ? "#8d5700" : "#d49a15"), x + depth, y + depth);
    }
    drawMaskOutline(ctx, source, x, y, 1.8, "#5d3300", 20, 0.92);
    ctx.globalAlpha = 1;
    ctx.drawImage(gradientTintCanvas(source, [[0, "#fffbe6"], [0.18, "#ffe998"], [0.42, "#b86e00"], [0.62, "#fff2a8"], [0.82, "#d38a00"], [1, "#fff8d2"]]), x, y);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(tint("#fff8cf"), x - 1, y - 2);
    if (options.hasExplicitColors) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.82;
      ctx.drawImage(source, x, y);
    }
  } else if (theme === "glitch") {
    drawSoftMask(ctx, source, x, y, "#ff1744", 8, 0.17, -3, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.72;
    ctx.drawImage(tint("#ff124f"), x - 3.5, y + 1);
    ctx.drawImage(tint("#00e5ff"), x + 3.5, y - 1);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(source, x, y);
    const slices = Math.max(7, Math.ceil(source.height / 13));
    for (let index = 0; index < slices; index += 1) {
      const height = 2 + Math.floor(random() * 8);
      const sliceY = Math.floor(random() * Math.max(1, source.height - height));
      const shift = Math.round((random() - 0.5) * 12);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 18, y + sliceY, source.width + 36, height);
      ctx.clip();
      ctx.drawImage(source, x + shift, y);
      ctx.restore();
    }
  } else if (theme === "pixel") {
    const cell = options.pixelCell || 6;
    const pixels = pixelateCanvas(source, cell);
    const px = x - Math.round((pixels.width - source.width) / 2);
    const py = y - Math.round((pixels.height - source.height) / 2);
    ctx.imageSmoothingEnabled = false;
    drawMaskOutline(ctx, pixels, px + cell, py + cell, cell * 0.65, "#3b0764", 16, 0.9);
    ctx.drawImage(tintCanvas(pixels, "#f97316"), px + cell, py + cell);
    ctx.drawImage(pixels, px, py);
    ctx.imageSmoothingEnabled = true;
  } else if (theme === "rainbow") {
    drawMaskOutline(ctx, source, x, y + 2, 5, "rgba(25,17,37,0.72)", 30, 0.82);
    drawMaskOutline(ctx, source, x, y, 2.5, "#ffffff", 24, 0.98);
    ctx.drawImage(gradientTintCanvas(source, [[0, "#ff0033"], [0.16, "#ff6600"], [0.33, "#ffcc00"], [0.5, "#33ff66"], [0.67, "#00ccff"], [0.84, "#3366ff"], [1, "#cc33ff"]], true), x, y);
    if (options.hasExplicitColors) {
      ctx.globalAlpha = 0.86;
      ctx.drawImage(source, x, y);
    }
  } else if (theme === "stamp") {
    const ink = distressCanvas(tint("#a30f21"), `${seed}:ink`, 0.0024);
    ctx.globalCompositeOperation = "multiply";
    drawMaskOutline(ctx, ink, x + 2, y + 3, 2.4, "rgba(77,5,15,0.65)", 20, 0.65);
    ctx.globalAlpha = 0.96;
    ctx.drawImage(ink, x, y);
    if (options.hasExplicitColors) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.84;
      ctx.drawImage(source, x, y);
    }
  } else if (theme === "sticker") {
    drawSoftMask(ctx, source, x, y, "#27345f", 12, 0.24, 0, 10);
    drawMaskOutline(ctx, source, x, y, 12, "#ffffff", 56, 1);
    drawMaskOutline(ctx, source, x, y, 2, "#29456f", 20, 0.82);
    ctx.drawImage(source, x, y);
  } else if (["speech", "banner", "fancy", "quote", "mono", "plain"].includes(theme)) {
    drawSoftMask(ctx, source, x, y, theme === "plain" ? "#000000" : "#25190f", 5, theme === "plain" ? 0.22 : 0.12, 0, 2);
    ctx.drawImage(source, x, y);
  } else {
    ctx.drawImage(source, x, y);
  }
  ctx.restore();
}

export function drawRichWithTheme(ctx, value, options = {}) {
  const theme = options.theme || "plain";
  const family = options.family || DEFAULT_FAMILY;
  const baseSize = options.fontSize || 40;
  const maxWidth = options.maxWidth || 520;
  // User-authored text is never shortened. If it exceeds the composition,
  // it is still painted and allowed to cross the theme's visual bounds.
  const defaultColor = options.color || "#0f1419";
  const mode = options.mode || "center";
  const centerX = options.cx ?? 360;
  const topY = options.topY ?? 160;
  const lineGap = options.lineGap || baseSize * 1.35;
  const runs = tokenizeRichText(value);
  const hasExplicitColors = runs.some(
    (run) => run.color || (run.math && /\\(?:color|textcolor)\b/.test(run.text)),
  );
  const displayThemes = new Set(["neon", "gold", "glitch", "pixel", "stamp", "banner", "rainbow", "sticker", "speech"]);
  if (displayThemes.has(theme)) {
    runs.forEach((run) => {
      if (!run.math && !run.code) run.bold = true;
    });
  }

  const lines = wrapRichRuns(ctx, runs, maxWidth, baseSize, family);
  const widths = lines.map((line) => line.reduce((sum, run) => sum + measureRun(ctx, run, baseSize, family).width, 0));
  const totalWidth = Math.max(1, ...widths);
  const totalHeight = Math.max(lineGap, lines.length * lineGap);
  const padding = Math.ceil(baseSize * 0.8) + 24;
  const offscreen = createCanvas(Math.ceil(totalWidth + padding * 2), Math.ceil(totalHeight + padding * 2));
  const offscreenCtx = offscreen.getContext("2d");
  offscreenCtx.textBaseline = "middle";
  lines.forEach((line, lineIndex) => {
    let x = padding;
    if (mode === "center") x += (offscreen.width - padding * 2 - widths[lineIndex]) / 2;
    const y = padding + lineGap * lineIndex + lineGap / 2;
    line.forEach((run) => {
      x += drawRun(offscreenCtx, run, x, y, baseSize, family, defaultColor);
    });
  });

  const source = cropAlphaBounds(offscreen);
  const x = mode === "center" ? Math.round(centerX - source.width / 2) : Math.round(centerX);
  const y = options.centerY != null
    ? Math.round(options.centerY - source.height / 2)
    : Math.round(topY);
  blitThemeEffect(ctx, source, theme, x, y, { ...options, hasExplicitColors });
  return { width: source.width, height: source.height, x, y, lines: lines.length };
}
