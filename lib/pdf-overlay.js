// Layout-preserving PDF output: keep the original page, cover each source paragraph and
// draw its translation in the same box, so figures, columns and pagination stay untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const FONT_CANDIDATES = [
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
];
const LINE_FACTOR = 1.38;
const PAGE_MARGIN = 22;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Find a single-file (TTF/OTF) font that can render Chinese. TTC collections cannot be embedded. */
export function resolveCjkFont(config = {}) {
  const candidates = [];
  if (config.fontPath) candidates.push(path.resolve(String(config.fontPath)));
  const dataDir = config.dataDir ? path.resolve(String(config.dataDir)) : path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'pdf-translator-mac');
  const fontDir = path.join(dataDir, 'fonts');
  try {
    for (const name of fs.readdirSync(fontDir)) {
      if (/\.(ttf|otf)$/i.test(name)) candidates.push(path.join(fontDir, name));
    }
  } catch {}
  candidates.push(...FONT_CANDIDATES);
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size > 500 * 1024) return candidate;
    } catch {}
  }
  throw new Error(
    '找不到可嵌入的中文 TTF/OTF 字体（macOS 的 PingFang/宋体是 .ttc 集合，无法直接嵌入）。'
    + `请把一个中文字体放到 ${fontDir}/ 目录（例如 Noto Sans SC），或在插件配置里指定 fontPath。`,
  );
}

class WidthCache {
  constructor(font) {
    this.font = font;
    this.cache = new Map();
    this.reference = 100;
  }

  char(ch) {
    let value = this.cache.get(ch);
    if (value === undefined) {
      try {
        value = this.font.widthOfTextAtSize(ch, this.reference) / this.reference;
      } catch {
        value = 0.5;
      }
      this.cache.set(ch, value);
    }
    return value;
  }

  text(value, size) {
    let total = 0;
    for (const ch of value) total += this.char(ch) * size;
    return total;
  }
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
const NO_LINE_START = /^[，。、；：？！）」』】》%,.;:!?)\]]/;

/** Greedy wrap: CJK may break anywhere, Latin breaks on spaces first, punctuation hangs. */
export function wrapText(value, widths, size, maxWidth) {
  const text = String(value).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const lines = [];
  let line = '';
  let lineWidth = 0;
  const push = (carry = '') => {
    if (line.trim()) lines.push(line.trimEnd());
    line = carry;
    lineWidth = widths.text(carry, size);
  };
  for (const ch of text) {
    if (ch === '\n') {
      push();
      continue;
    }
    const advance = widths.text(ch, size);
    if (lineWidth + advance <= maxWidth || !line) {
      line += ch;
      lineWidth += advance;
      continue;
    }
    if (NO_LINE_START.test(ch)) {
      // Closing punctuation may overhang the right margin instead of starting a new line.
      line += ch;
      lineWidth += advance;
      push();
      continue;
    }
    if (CJK.test(ch) || CJK.test(line.slice(-1))) {
      push(ch);
      continue;
    }
    const space = line.lastIndexOf(' ');
    if (space > 0) {
      const tail = line.slice(space + 1);
      lines.push(line.slice(0, space).trimEnd());
      line = tail + ch;
      lineWidth = widths.text(line, size);
      continue;
    }
    push(ch);
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

function blockBox(block) {
  const lines = (block.lines || []).filter((line) => Number.isFinite(line.baseline) && line.left !== undefined);
  if (!lines.length) return null;
  const height = median(lines.map((line) => line.h)) || 9;
  return {
    lines,
    height,
    left: Math.min(...lines.map((line) => line.left)),
    right: Math.max(...lines.map((line) => line.right)),
    top: Math.max(...lines.map((line) => line.baseline + line.h * 0.9)),
    bottom: Math.min(...lines.map((line) => line.baseline - line.h * 0.3)),
  };
}

/**
 * Add translated text over the original pages.
 * @param {{sourcePath:string, outputPath:string, pages:Array, config?:object, title?:string}} input
 */
export async function writeOverlayPdf(input) {
  const { sourcePath, outputPath, pages, config = {}, title } = input;
  const fontPath = resolveCjkFont(config);
  const source = await fs.promises.readFile(sourcePath);
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fs.promises.readFile(fontPath), { subset: true });
  const widths = new WidthCache(font);
  const ink = rgb(0.06, 0.07, 0.09);
  const paper = rgb(1, 1, 1);
  const skipped = [];
  let drawnBlocks = 0;
  let drawnChars = 0;

  for (const page of pages) {
    const index = page.page - 1;
    if (index < 0 || index >= doc.getPageCount()) {
      skipped.push(page.page);
      continue;
    }
    const pdfPage = doc.getPage(index);
    const rotation = pdfPage.getRotation();
    const crop = pdfPage.getCropBox();
    const media = pdfPage.getMediaBox();
    const rotated = rotation && Math.abs(rotation.angle || 0) > 0.01;
    const offset = Math.abs(crop.x) > 1 || Math.abs(crop.y) > 1 || Math.abs(crop.width - media.width) > 1 || Math.abs(crop.height - media.height) > 1;
    if (rotated || offset) {
      skipped.push(page.page);
      continue;
    }
    const pageWidth = pdfPage.getWidth();
    const prepared = [];
    const boxes = page.blocks
      .map((block) => ({ block, box: blockBox(block) }))
      .filter((entry) => entry.box && entry.block.dst && entry.block.dst.trim());
    const allBoxes = page.blocks.map((block) => blockBox(block)).filter(Boolean);
    const columnRight = (box) => {
      const narrow = box.right - box.left;
      let right = box.right;
      for (const other of allBoxes) {
        const overlap = Math.min(box.right, other.right) - Math.max(box.left, other.left);
        if (overlap > Math.max(10, Math.min(narrow, other.right - other.left) * 0.3)) {
          right = Math.max(right, other.right);
        }
      }
      return right;
    };
    for (const entry of boxes) {
      const { block, box } = entry;
      const text = String(block.dst).replace(/\s+$/g, '').trim();
      if (!text) continue;
      const width = Math.max(24, box.right - box.left);
      const neighbours = boxes
        .map((candidate) => candidate.box)
        .filter((candidate) => candidate !== box && candidate.top < box.bottom - 1);
      const nextTop = neighbours.length ? Math.max(...neighbours.map((candidate) => candidate.top)) : null;
      const limitBottom = Math.max(
        PAGE_MARGIN,
        nextTop === null
          ? box.bottom - box.height * 3
          : Math.max(box.bottom - box.height * 3, nextTop + 2),
      );
      const availableHeight = Math.max(box.height, box.top - limitBottom);
      const centered = box.lines.length <= 3
        && box.lines.every((line) => Math.abs((line.left + line.right) / 2 - pageWidth / 2) < box.height * 3.2);
      const maxSize = box.height * 1.06;
      const minSize = Math.max(4.5, box.height * 0.55);
      let chosen = null;
      // A one-line source should normally stay one line: try shrinking before wrapping onto a second line.
      if (box.lines.length === 1) {
        for (let size = maxSize; size >= minSize; size -= 0.25) {
          const wrapped = wrapText(text, widths, size, width);
          if (wrapped.length === 1) {
            chosen = { size, wrapped };
            break;
          }
        }
      }
      for (let size = maxSize; !chosen && size >= minSize; size -= 0.25) {
        const wrapped = wrapText(text, widths, size, width);
        if (wrapped.length * size * LINE_FACTOR <= availableHeight + 0.5) chosen = { size, wrapped };
      }
      if (!chosen) {
        const size = minSize;
        const wrapped = wrapText(text, widths, size, width);
        const maxLines = Math.max(1, Math.floor(availableHeight / (size * LINE_FACTOR)));
        chosen = { size, wrapped: wrapped.slice(0, maxLines) };
      }
      const lastBaseline = box.top - chosen.size * 0.88 - (chosen.wrapped.length - 1) * chosen.size * LINE_FACTOR;
      let drawnLeft = box.left;
      let drawnRight = box.left;
      for (const line of chosen.wrapped) {
        const lineWidth = widths.text(line, chosen.size);
        const x = centered ? box.left + (width - lineWidth) / 2 : box.left;
        drawnLeft = Math.min(drawnLeft, x);
        drawnRight = Math.max(drawnRight, x + lineWidth);
      }
      const rightEdge = columnRight(box);
      prepared.push({
        block,
        box,
        width,
        centered,
        chosen,
        drawnLeft,
        drawnRight,
        columnRight: rightEdge,
        coverBottom: Math.min(box.bottom - 1.8, lastBaseline - chosen.size * 0.3),
      });
    }
    // Covers first, then every text: an overhanging line keeps its own white background.
    for (const item of prepared) {
      const coverTop = item.box.top + 1.8;
      const coverLeft = Math.min(item.box.left, item.drawnLeft) - 1.6;
      const coverRight = Math.max(item.box.right, item.drawnRight, item.columnRight) + 1.8;
      pdfPage.drawRectangle({
        x: coverLeft,
        y: item.coverBottom,
        width: Math.max(4, coverRight - coverLeft),
        height: coverTop - item.coverBottom,
        color: paper,
      });
    }
    for (const item of prepared) {
      const { box, chosen, centered, width } = item;
      chosen.wrapped.forEach((line, lineIndex) => {
        if (!line) return;
        const lineWidth = widths.text(line, chosen.size);
        const x = centered ? box.left + Math.max(0, (width - lineWidth) / 2) : box.left;
        const y = box.top - chosen.size * 0.88 - lineIndex * chosen.size * LINE_FACTOR;
        pdfPage.drawText(line, { x, y, size: chosen.size, font, color: ink });
      });
      drawnBlocks += 1;
      drawnChars += String(item.block.dst).trim().length;
    }
  }

  if (drawnBlocks === 0) {
    throw new Error('没有可写入的原版式文字块（可能是扫描页没有文字坐标，或所有页都被旋转/裁切保护跳过）。');
  }

  doc.setTitle(title ? `${title}（中文）` : 'PDF 翻译');
  doc.setProducer('dsh pdf-translator-mac');
  const bytes = await doc.save();
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, bytes);
  return {
    path: outputPath,
    pages: pages.length - skipped.length,
    blocks: drawnBlocks,
    chars: drawnChars,
    skippedPages: skipped,
    font: path.basename(fontPath),
    bytes: bytes.length,
  };
}
