import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fonts = [
  {
    name: "NotoSansJP.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
  },
  {
    name: "NotoSerifJP.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf",
  },
];

const outputDirectory = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
const minFontBytes = 2_000_000;
const maxFontBytes = 30_000_000;

async function validExistingFont(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size >= minFontBytes && info.size <= maxFontBytes;
  } catch {
    return false;
  }
}

function hasTrueTypeSignature(bytes) {
  if (bytes.length < 4) return false;
  const signature = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  return signature === "00010000" || Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "OTTO";
}

async function downloadFont(font) {
  const destination = `${outputDirectory}${font.name}`;
  if (await validExistingFont(destination)) {
    process.stdout.write(`Using cached ${font.name}\n`);
    return;
  }
  const response = await fetch(font.url, {
    headers: { "user-agent": "karotter-tbot-render-build/1.0" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Failed to download ${font.name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < minFontBytes || bytes.byteLength > maxFontBytes || !hasTrueTypeSignature(bytes)) {
    throw new Error(`Downloaded ${font.name} is not a valid expected font file`);
  }
  const temporary = `${destination}.download`;
  await writeFile(temporary, bytes);
  await unlink(destination).catch(() => {});
  await rename(temporary, destination);
  process.stdout.write(`Installed ${font.name} (${bytes.byteLength} bytes)\n`);
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(fonts.map(downloadFont));
