import fs from 'node:fs/promises';
import path from 'node:path';
import figlet from 'figlet';
import gifenc from 'gifenc';
import sharp from 'sharp';

const { GIFEncoder, applyPalette } = gifenc;

const root = process.cwd();
const outDir = path.join(root, 'assets');
const gifPath = path.join(outDir, 'hero.gif');
const pngPath = path.join(outDir, 'hero.png');

const width = 1280;
const height = 460;
const frameCount = 12;
const delayMs = 140;
const mono = 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
const figletFont = 'ANSI Shadow';

const rows = [
  {
    text: 'AGENTS CAN GROW.',
    y: 78,
    fill: '#fff7ed',
    size: 8.8,
    lineHeight: 10.4,
    start: 0.05,
    duration: 0.24,
  },
  {
    text: 'XIAO BA',
    y: 182,
    fill: '#f5c542',
    size: 15.2,
    lineHeight: 17.2,
    start: 0.26,
    duration: 0.28,
  },
  {
    text: 'MAKES GROWTH REVIEWABLE.',
    y: 338,
    fill: '#f1d18a',
    size: 6.7,
    lineHeight: 8.1,
    start: 0.55,
    duration: 0.26,
  },
].map((item) => {
  const ascii = toFiglet(item.text);
  const maxWidth = Math.max(...ascii.map((lineValue) => lineValue.length));
  return { ...item, ascii, maxWidth, charWidth: item.size * 0.61 };
});

const palette = buildPalette();

function toFiglet(value) {
  return figlet.textSync(value, {
    font: figletFont,
    horizontalLayout: 'default',
    verticalLayout: 'default',
  }).split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function easeOut(t) {
  return 1 - Math.pow(1 - clamp(t), 3);
}

function easeInOut(t) {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function attr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function opacity(value) {
  return clamp(value).toFixed(3);
}

function text(x, y, value, options = {}) {
  const {
    size = 14,
    weight = 800,
    fill = '#d1fae5',
    anchor = 'middle',
    alpha = 1,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" opacity="${opacity(alpha)}" font-family="${mono}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" xml:space="preserve">${attr(value)}</text>`;
}

function line(x1, y1, x2, y2, options = {}) {
  const {
    stroke = '#7c5a16',
    strokeWidth = 1,
    alpha = 1,
  } = options;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity(alpha)}"/>`;
}

function revealAscii(lines, progress) {
  const maxWidth = Math.max(...lines.map((line) => line.length));
  const visibleWidth = Math.floor(easeOut(progress) * maxWidth);
  return lines.map((line) => line.padEnd(maxWidth).slice(0, visibleWidth));
}

function renderAsciiBlock(block, t) {
  const progress = clamp((t - block.start) / block.duration);
  const visible = revealAscii(block.ascii, progress);
  const alpha = progress <= 0 ? 0 : 0.92 + Math.sin(t * Math.PI * 3) * 0.05;
  const blockLeft = (width - block.maxWidth * block.charWidth) / 2;
  return visible.map((lineValue, index) => text(blockLeft, block.y + index * block.lineHeight, lineValue, {
    size: block.size,
    fill: block.fill,
    alpha,
    anchor: 'start',
  })).join('\n');
}

function renderSvg(frame) {
  const t = frame / (frameCount - 1);
  const cursorBlock = rows.findLast((row) => t >= row.start) ?? rows[0];
  const cursorProgress = clamp((t - cursorBlock.start) / cursorBlock.duration);
  const cursorX = (width - cursorBlock.maxWidth * cursorBlock.charWidth) / 2 + cursorBlock.maxWidth * cursorBlock.charWidth * easeOut(cursorProgress);
  const cursorY = cursorBlock.y - cursorBlock.lineHeight + cursorBlock.ascii.length * cursorBlock.lineHeight + 5;
  const cursorAlpha = t < 0.91 ? 0.65 + 0.35 * (Math.sin(t * Math.PI * 20) > 0 ? 1 : 0) : 0;
  const footerProgress = clamp((t - 0.88) / 0.10);
  const footerAlpha = easeOut(footerProgress) * 0.95;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#050403"/>
  <rect width="${width}" height="${height}" fill="#211504" opacity="0.16"/>
  ${line(118, 55, 1162, 55, { stroke: '#7c5a16', alpha: 0.35 })}

  ${rows.map((row) => renderAsciiBlock(row, t)).join('\n')}

  ${text(width / 2, 407, 'trace / replay / arena / scorecard', { size: 24, weight: 800, fill: '#f6d37a', alpha: footerAlpha })}
  <rect x="${cursorX}" y="${cursorY}" width="9" height="18" fill="#facc15" opacity="${opacity(cursorAlpha)}"/>
</svg>`;
}

async function svgToIndexedFrame(svg) {
  const rgba = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return applyPalette(rgba, palette);
}

function encodeGif(frames) {
  const gif = GIFEncoder();
  for (let index = 0; index < frames.length; index++) {
    gif.writeFrame(frames[index], width, height, {
      delay: delayMs,
      repeat: 0,
      ...(index === 0 ? { palette } : {}),
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

function buildPalette() {
  const colors = [
    '#050403', '#0a0805', '#120d05', '#1f1606', '#211504', '#3d2a08', '#5b3b08', '#7c5a16',
    '#8a6a2a', '#a16207', '#b45309', '#d97706', '#eab308', '#f5c542', '#f6d37a',
    '#f1d18a', '#fde68a', '#fff7ed', '#fffbeb', '#ffffff',
  ].map((hex) => {
    const value = hex.slice(1);
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  });

  for (let index = 0; index < 76; index++) {
    const value = Math.round((index / 75) * 255);
    colors.push([value, value, value]);
  }

  const ramps = [
    [5, 4, 3, 245, 197, 66],
    [5, 4, 3, 255, 247, 237],
    [33, 21, 4, 246, 211, 122],
  ];
  for (const [r0, g0, b0, r1, g1, b1] of ramps) {
    for (let i = 0; i < 48; i++) {
      const mix = i / 47;
      colors.push([
        Math.round(r0 + (r1 - r0) * mix),
        Math.round(g0 + (g1 - g0) * mix),
        Math.round(b0 + (b1 - b0) * mix),
      ]);
    }
  }

  while (colors.length < 256) colors.push(colors[colors.length - 1]);
  return colors.slice(0, 256);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const frames = [];
  for (let frame = 0; frame < frameCount; frame++) {
    frames.push(await svgToIndexedFrame(renderSvg(frame)));
  }

  await fs.writeFile(gifPath, encodeGif(frames));
  await sharp(Buffer.from(renderSvg(frameCount - 1)))
    .png({ compressionLevel: 9, palette: true })
    .toFile(pngPath);

  const gifStats = await fs.stat(gifPath);
  const pngStats = await fs.stat(pngPath);
  console.log(`generated ${path.relative(root, gifPath)} ${(gifStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`generated ${path.relative(root, pngPath)} ${(pngStats.size / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
