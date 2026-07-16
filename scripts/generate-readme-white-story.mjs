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
const mono = 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
const figletFont = 'ANSI Shadow';

const colors = {
  background: '#ffffff',
  ink: '#202631',
  muted: '#737985',
  faint: '#e8e4dc',
  accent: '#b88712',
  accentSoft: '#d7b75f',
};

const copy = {
  work: {
    top: 'MESSAGE YOUR WORK.',
    bottom: 'WORKS LIKE A TEAMMATE.',
  },
  evolution: {
    top: 'REVIEW WHAT CHANGED.',
    bottom: 'MAKES GROWTH REVIEWABLE.',
  },
};

const track = {
  y: 284,
  x1: 312,
  x2: 968,
  nodes: [
    { label: 'DELIVER', progress: 0 },
    { label: 'EVIDENCE', progress: 1 / 3 },
    { label: 'REPLAY', progress: 2 / 3 },
    { label: 'REVIEW', progress: 1 },
  ],
};

const palette = buildPalette();
const rowLayouts = {
  top: buildRowLayout([copy.work.top, copy.evolution.top], 7.7, 1080),
  bottom: buildRowLayout([copy.work.bottom, copy.evolution.bottom], 6.9, 1120),
};

function toFiglet(value) {
  if (!value) return [];
  return figlet.textSync(value, {
    font: figletFont,
    horizontalLayout: 'default',
    verticalLayout: 'default',
  }).split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function buildRowLayout(values, preferredSize, maxPixelWidth) {
  const maxCharacters = Math.max(...values.map((value) => {
    const rows = toFiglet(value);
    return Math.max(...rows.map((row) => row.length));
  }));
  const size = Math.min(preferredSize, maxPixelWidth / (maxCharacters * 0.61));
  return {
    size,
    lineHeight: size * 1.17,
  };
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function ease(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
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
    weight = 700,
    fill = colors.ink,
    anchor = 'middle',
    alpha = 1,
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" opacity="${opacity(alpha)}" font-family="${mono}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}" xml:space="preserve">${attr(value)}</text>`;
}

function line(x1, y1, x2, y2, options = {}) {
  const {
    stroke = colors.faint,
    strokeWidth = 1,
    alpha = 1,
  } = options;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity(alpha)}" stroke-linecap="round"/>`;
}

function asciiBlock(value, y, layout, options = {}) {
  if (!value) return '';
  const {
    fill = colors.ink,
    alpha = 1,
  } = options;
  const rows = toFiglet(value);
  const charWidth = layout.size * 0.61;
  const pixelWidth = Math.max(...rows.map((row) => row.length)) * charWidth;
  const left = (width - pixelWidth) / 2;
  return rows.map((row, index) => text(left, y + index * layout.lineHeight, row, {
    size: layout.size,
    weight: 800,
    fill,
    alpha,
    anchor: 'start',
  })).join('\n');
}

function cursorMarkup(value, y, layout, alpha) {
  if (!value || alpha <= 0) return '';
  const rows = toFiglet(value);
  const charWidth = layout.size * 0.61;
  const pixelWidth = Math.max(...rows.map((row) => row.length)) * charWidth;
  const left = (width - pixelWidth) / 2;
  return `<rect x="${left + pixelWidth + 8}" y="${y + rows.length * layout.lineHeight - 18}" width="7" height="17" rx="1" fill="${colors.accent}" opacity="${opacity(alpha)}"/>`;
}

function phaseCopyMarkup(state) {
  if (!state.phase) return '';
  const phase = copy[state.phase];
  const topValue = phase.top.slice(0, state.topChars);
  const bottomValue = phase.bottom.slice(0, state.bottomChars);
  return `
    ${asciiBlock(topValue, 67, rowLayouts.top, { alpha: state.copyAlpha })}
    ${asciiBlock(bottomValue, 348, rowLayouts.bottom, { alpha: state.copyAlpha })}
    ${cursorMarkup(topValue, 67, rowLayouts.top, state.cursorRow === 'top' ? state.cursorAlpha * state.copyAlpha : 0)}
    ${cursorMarkup(bottomValue, 348, rowLayouts.bottom, state.cursorRow === 'bottom' ? state.cursorAlpha * state.copyAlpha : 0)}`;
}

function logoMarkup() {
  return asciiBlock('XIAOBA', 166, { size: 15.2, lineHeight: 17.3 }, {
    fill: colors.accent,
    alpha: 0.98,
  });
}

function trackMarkup(state) {
  const progress = clamp(state.trackProgress);
  const activeX = track.x1 + (track.x2 - track.x1) * progress;
  const alpha = state.trackAlpha;
  const passedLine = line(track.x1, track.y, activeX, track.y, {
    stroke: colors.accentSoft,
    strokeWidth: 2,
    alpha,
  });
  const remainingLine = line(activeX, track.y, track.x2, track.y, {
    stroke: colors.faint,
    strokeWidth: 1.4,
    alpha,
  });

  const nodes = track.nodes.map((node) => {
    const x = track.x1 + (track.x2 - track.x1) * node.progress;
    const isPassed = progress + 0.015 >= node.progress;
    const nodeFill = isPassed ? colors.accent : colors.background;
    const nodeStroke = isPassed ? colors.accent : '#c8c3b9';
    const labelAlpha = alpha * (isPassed ? 0.95 : 0.48);
    const evidenceHalo = node.label === 'EVIDENCE' && Math.abs(progress - node.progress) < 0.08
      ? `<circle cx="${x}" cy="${track.y}" r="10" fill="none" stroke="${colors.accentSoft}" stroke-width="1" opacity="${opacity(alpha * 0.55)}"/>`
      : '';
    return `${evidenceHalo}
      <circle cx="${x}" cy="${track.y}" r="4.5" fill="${nodeFill}" stroke="${nodeStroke}" stroke-width="1.5" opacity="${opacity(alpha)}"/>
      ${text(x, track.y + 28, node.label, {
        size: 10.5,
        weight: isPassed ? 760 : 620,
        fill: isPassed ? colors.ink : colors.muted,
        alpha: labelAlpha,
        letterSpacing: 1.05,
      })}`;
  }).join('\n');

  const activeDot = `<circle cx="${activeX}" cy="${track.y}" r="3" fill="${colors.background}" stroke="${colors.accent}" stroke-width="2" opacity="${opacity(alpha)}"/>`;
  return `${remainingLine}\n${passedLine}\n${nodes}\n${activeDot}`;
}

function renderSvg(state) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${colors.background}"/>
  ${phaseCopyMarkup(state)}
  ${logoMarkup()}
  ${trackMarkup(state)}
</svg>`;
}

function fullState(phase, delay) {
  return {
    phase,
    topChars: copy[phase].top.length,
    bottomChars: copy[phase].bottom.length,
    copyAlpha: 1,
    cursorAlpha: 0,
    cursorRow: null,
    trackAlpha: 0.92,
    trackProgress: phase === 'work' ? 1 / 3 : 1,
    delay,
  };
}

function buildTimeline() {
  const frames = [];

  // The first frame is a complete poster. The last frame resolves to the same
  // state, so GitHub never shows a blank thumbnail and the loop has no jump.
  frames.push(fullState('work', 1150));

  const bridgeFrames = 15;
  for (let index = 1; index <= bridgeFrames; index++) {
    const progress = ease(index / bridgeFrames);
    frames.push({
      phase: 'work',
      topChars: copy.work.top.length,
      bottomChars: copy.work.bottom.length,
      copyAlpha: 1 - progress,
      cursorAlpha: 0,
      cursorRow: null,
      trackAlpha: 0.92,
      trackProgress: 1 / 3 + progress * (2 / 3),
      delay: 78,
    });
  }

  const characterDelay = 68;
  for (let index = 1; index <= copy.evolution.top.length; index++) {
    frames.push({
      phase: 'evolution',
      topChars: index,
      bottomChars: 0,
      copyAlpha: 1,
      cursorAlpha: index % 3 === 0 ? 0.5 : 1,
      cursorRow: 'top',
      trackAlpha: 0.92,
      trackProgress: 1,
      delay: characterDelay,
    });
  }

  frames.push({
    phase: 'evolution',
    topChars: copy.evolution.top.length,
    bottomChars: 0,
    copyAlpha: 1,
    cursorAlpha: 0,
    cursorRow: null,
    trackAlpha: 0.92,
    trackProgress: 1,
    delay: 260,
  });

  for (let index = 1; index <= copy.evolution.bottom.length; index++) {
    frames.push({
      phase: 'evolution',
      topChars: copy.evolution.top.length,
      bottomChars: index,
      copyAlpha: 1,
      cursorAlpha: index % 3 === 0 ? 0.5 : 1,
      cursorRow: 'bottom',
      trackAlpha: 0.92,
      trackProgress: 1,
      delay: characterDelay,
    });
  }

  frames.push(fullState('evolution', 1550));

  const resetFrames = 9;
  for (let index = 1; index <= resetFrames; index++) {
    const progress = ease(index / resetFrames);
    frames.push({
      phase: 'evolution',
      topChars: copy.evolution.top.length,
      bottomChars: copy.evolution.bottom.length,
      copyAlpha: 1 - progress,
      cursorAlpha: 0,
      cursorRow: null,
      trackAlpha: 0.92 * (1 - progress),
      trackProgress: 1,
      delay: 70,
    });
  }

  const workCharacterCount = copy.work.top.length + copy.work.bottom.length;
  for (let index = 1; index <= copy.work.top.length; index++) {
    const progress = ease(index / workCharacterCount);
    frames.push({
      phase: 'work',
      topChars: index,
      bottomChars: 0,
      copyAlpha: 1,
      cursorAlpha: index % 3 === 0 ? 0.5 : 1,
      cursorRow: 'top',
      trackAlpha: 0.92 * progress,
      trackProgress: (1 / 3) * progress,
      delay: characterDelay,
    });
  }

  frames.push({
    phase: 'work',
    topChars: copy.work.top.length,
    bottomChars: 0,
    copyAlpha: 1,
    cursorAlpha: 0,
    cursorRow: null,
    trackAlpha: 0.92 * ease(copy.work.top.length / workCharacterCount),
    trackProgress: (1 / 3) * ease(copy.work.top.length / workCharacterCount),
    delay: 260,
  });

  for (let index = 1; index <= copy.work.bottom.length; index++) {
    const progress = ease((copy.work.top.length + index) / workCharacterCount);
    frames.push({
      phase: 'work',
      topChars: copy.work.top.length,
      bottomChars: index,
      copyAlpha: 1,
      cursorAlpha: index % 3 === 0 ? 0.5 : 1,
      cursorRow: 'bottom',
      trackAlpha: 0.92 * progress,
      trackProgress: (1 / 3) * progress,
      delay: characterDelay,
    });
  }

  frames.push(fullState('work', 950));
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
  const entries = [
    colors.background,
    colors.ink,
    colors.muted,
    colors.faint,
    colors.accent,
    colors.accentSoft,
    '#f8f6f1',
    '#eee9dd',
    '#c8c3b9',
    '#000000',
  ].map(hexToRgb);

  const ramps = [
    [32, 38, 49, 115, 121, 133],
    [184, 135, 18, 215, 183, 95],
    [200, 195, 185, 255, 255, 255],
  ];
  for (const [r0, g0, b0, r1, g1, b1] of ramps) {
    for (let index = 0; index < 80; index++) {
      const mix = index / 79;
      entries.push([
        Math.round(r0 + (r1 - r0) * mix),
        Math.round(g0 + (g1 - g0) * mix),
        Math.round(b0 + (b1 - b0) * mix),
      ]);
    }
  }
  while (entries.length < 256) entries.push(entries[entries.length - 1]);
  return entries.slice(0, 256);
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

  const stats = await fs.stat(gifPath);
  const durationMs = timeline.reduce((sum, frame) => sum + frame.delay, 0);
  console.log(`generated ${path.relative(root, gifPath)} ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`${timeline.length} frames / ${(durationMs / 1000).toFixed(2)} seconds / complete poster frame`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
