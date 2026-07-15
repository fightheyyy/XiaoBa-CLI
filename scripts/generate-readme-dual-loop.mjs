import fs from 'node:fs/promises';
import path from 'node:path';
import figlet from 'figlet';
import gifenc from 'gifenc';
import sharp from 'sharp';

const { GIFEncoder, applyPalette } = gifenc;

const root = process.cwd();
const outDir = path.join(root, 'assets');
const gifPath = path.join(outDir, 'readme-hero.gif');

const width = 1280;
const height = 460;
const panelWidth = width / 2;
const mono = 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
const figletFont = 'ANSI Shadow';
const dividerGold = '#dba52b';

const panels = [
  {
    x: 0,
    background: '#ead9a6',
    foreground: '#172a3a',
    muted: '#586672',
    rule: '#b99a4c',
    accent: '#a96300',
    eyebrow: '01  /  WORK LOOP',
    headline: 'MESSAGE YOUR WORK.',
    statement: 'WORKS LIKE A TEAMMATE.',
    footer: 'dispatch  /  execute  /  deliver  /  evidence',
  },
  {
    x: panelWidth,
    background: '#17324d',
    foreground: '#f4e8c8',
    muted: '#b8c5d0',
    rule: '#496985',
    accent: '#e8b23a',
    eyebrow: '02  /  EVOLUTION LOOP',
    headline: 'AGENTS CAN GROW.',
    statement: 'MAKES GROWTH REVIEWABLE.',
    footer: 'trace  /  replay  /  arena  /  scorecard',
  },
];

const headlineFrames = Math.max(...panels.map((panel) => panel.headline.length));
const statementFrames = Math.max(...panels.map((panel) => panel.statement.length));
const palette = buildPalette();

function toFiglet(value) {
  if (!value) return [];
  return figlet.textSync(value, {
    font: figletFont,
    horizontalLayout: 'default',
    verticalLayout: 'default',
  }).split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function attr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function opacity(value) {
  return clamp(value).toFixed(3);
}

function text(x, y, value, options = {}) {
  const {
    size = 14,
    weight = 700,
    fill = '#211d17',
    anchor = 'middle',
    alpha = 1,
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" opacity="${opacity(alpha)}" font-family="${mono}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}" xml:space="preserve">${attr(value)}</text>`;
}

function line(x1, y1, x2, y2, options = {}) {
  const { stroke = dividerGold, strokeWidth = 1, alpha = 1 } = options;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity(alpha)}"/>`;
}

function asciiBlock(panel, value, options = {}) {
  const {
    y,
    size,
    lineHeight,
    fill = panel.foreground,
    alpha = 1,
  } = options;
  const rows = toFiglet(value);
  if (rows.length === 0) return '';
  const charWidth = size * 0.61;
  const fullRows = toFiglet(options.fullValue ?? value);
  const maxWidth = Math.max(...fullRows.map((row) => row.length));
  const left = panel.x + (panelWidth - maxWidth * charWidth) / 2;
  return rows.map((row, index) => text(left, y + index * lineHeight, row, {
    size,
    weight: 800,
    fill,
    alpha,
    anchor: 'start',
  })).join('\n');
}

function panelMarkup(panel, state) {
  const headline = panel.headline.slice(0, state.headlineChars);
  const statement = panel.statement.slice(0, state.statementChars);
  const center = panel.x + panelWidth / 2;
  const headlineCursorX = cursorX(panel, headline, panel.headline, 4.25);
  const statementCursorX = cursorX(panel, statement, panel.statement, 3.45);
  const statementSize = 3.45;

  return `
    <rect x="${panel.x}" y="0" width="${panelWidth}" height="${height}" fill="${panel.background}"/>
    ${line(panel.x + 46, 48, panel.x + panelWidth - 46, 48, { stroke: panel.rule })}
    ${text(panel.x + 48, 34, panel.eyebrow, {
      size: 11,
      weight: 750,
      fill: panel.muted,
      anchor: 'start',
      letterSpacing: 1.25,
    })}
    ${asciiBlock(panel, headline, {
      y: 94,
      size: 4.25,
      lineHeight: 5.1,
      fill: panel.foreground,
      fullValue: panel.headline,
    })}
    ${asciiBlock(panel, 'XIAOBA', {
      y: 184,
      size: 9.2,
      lineHeight: 10.9,
      fill: panel.accent,
    })}
    ${asciiBlock(panel, statement, {
      y: 310,
      size: statementSize,
      lineHeight: 4.2,
      fill: panel.foreground,
      fullValue: panel.statement,
    })}
    ${state.activeRow === 'headline' ? `<rect x="${headlineCursorX}" y="113" width="6" height="13" fill="${panel.accent}" opacity="${opacity(state.cursorAlpha)}"/>` : ''}
    ${state.activeRow === 'statement' ? `<rect x="${statementCursorX}" y="330" width="6" height="13" fill="${panel.accent}" opacity="${opacity(state.cursorAlpha)}"/>` : ''}
    ${line(panel.x + 46, 390, panel.x + panelWidth - 46, 390, { stroke: panel.rule, alpha: state.footerAlpha })}
    ${text(center, 417, panel.footer, {
      size: 11.5,
      weight: 650,
      fill: panel.muted,
      alpha: state.footerAlpha,
      letterSpacing: 0.45,
    })}`;
}

function cursorX(panel, value, fullValue, size) {
  const visibleRows = toFiglet(value);
  const fullRows = toFiglet(fullValue);
  const charWidth = size * 0.61;
  const fullWidth = Math.max(...fullRows.map((row) => row.length));
  const left = panel.x + (panelWidth - fullWidth * charWidth) / 2;
  const visibleWidth = visibleRows.length > 0 ? Math.max(...visibleRows.map((row) => row.length)) : 0;
  return left + visibleWidth * charWidth + 4;
}

function renderSvg(state) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${panels.map((panel) => panelMarkup(panel, state)).join('\n')}
  <rect x="639" y="0" width="2" height="${height}" fill="${dividerGold}" opacity="0.88"/>
</svg>`;
}

function buildTimeline() {
  const frames = [];

  // A complete first frame doubles as GitHub's loading poster and extends the
  // completed hold seamlessly across the GIF loop boundary.
  frames.push({
    headlineChars: headlineFrames,
    statementChars: statementFrames,
    footerAlpha: 1,
    activeRow: null,
    cursorAlpha: 0,
    delay: 1400,
  });

  frames.push({
    headlineChars: 0,
    statementChars: 0,
    footerAlpha: 0,
    activeRow: 'headline',
    cursorAlpha: 1,
    delay: 420,
  });

  for (let index = 1; index <= headlineFrames; index++) {
    frames.push({
      headlineChars: index,
      statementChars: 0,
      footerAlpha: 0,
      activeRow: 'headline',
      cursorAlpha: index % 2 === 0 ? 1 : 0.58,
      delay: 95,
    });
  }

  frames.push({
    headlineChars: headlineFrames,
    statementChars: 0,
    footerAlpha: 0,
    activeRow: 'statement',
    cursorAlpha: 1,
    delay: 320,
  });

  for (let index = 1; index <= statementFrames; index++) {
    frames.push({
      headlineChars: headlineFrames,
      statementChars: index,
      footerAlpha: 0,
      activeRow: 'statement',
      cursorAlpha: index % 2 === 0 ? 1 : 0.58,
      delay: 95,
    });
  }

  for (let index = 1; index <= 6; index++) {
    frames.push({
      headlineChars: headlineFrames,
      statementChars: statementFrames,
      footerAlpha: index / 6,
      activeRow: index < 4 ? 'statement' : null,
      cursorAlpha: index % 2 === 0 ? 1 : 0.58,
      delay: 80,
    });
  }

  frames.push({
    headlineChars: headlineFrames,
    statementChars: statementFrames,
    footerAlpha: 1,
    activeRow: null,
    cursorAlpha: 0,
    delay: 2600,
  });

  return frames;
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
    gif.writeFrame(frames[index].pixels, width, height, {
      delay: frames[index].delay,
      repeat: 0,
      ...(index === 0 ? { palette } : {}),
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

function hexToRgb(hex) {
  const value = hex.slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function buildPalette() {
  const colors = [
    '#172a3a', '#17324d', '#203b50', '#304f68', '#496985', '#586672', '#7b8994', '#9baab6',
    '#b8c5d0', '#a96300', '#b99a4c', '#dba52b', '#e8b23a', '#ead9a6', '#f4e8c8', '#f9f1dc',
    '#ffffff', '#000000',
  ].map(hexToRgb);

  const ramps = [
    [23, 42, 58, 73, 105, 133],
    [185, 154, 76, 244, 232, 200],
    [169, 99, 0, 232, 178, 58],
    [123, 137, 148, 244, 232, 200],
  ];
  for (const [r0, g0, b0, r1, g1, b1] of ramps) {
    for (let index = 0; index < 56; index++) {
      const mix = index / 55;
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
  const timeline = buildTimeline();
  const frames = [];

  for (const state of timeline) {
    frames.push({
      pixels: await svgToIndexedFrame(renderSvg(state)),
      delay: state.delay,
    });
  }

  await fs.writeFile(gifPath, encodeGif(frames));

  const gifStats = await fs.stat(gifPath);
  const totalMs = timeline.reduce((sum, frame) => sum + frame.delay, 0);
  console.log(`generated ${path.relative(root, gifPath)} ${(gifStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`${timeline.length} frames / ${(totalMs / 1000).toFixed(2)} seconds / non-empty poster frame`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
