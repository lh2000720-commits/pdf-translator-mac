// PDF text extraction for the macOS DSH plugin: pdfjs-dist (bundled dependency) -> per-page paragraphs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');

let pdfjsPromise;
let standardFontDataUrl;

function candidatePdfjsEntries() {
  const entries = [];
  try {
    const require = createRequire(path.join(packageRoot, 'package.json'));
    entries.push(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  } catch {}
  const profile = process.env.DSH_PROFILE_DIR;
  if (profile) entries.push(path.join(profile, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  entries.push(path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  return entries;
}

/** Load the bundled pdfjs build once; explain clearly when the dependency is missing. */
export async function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const tried = [];
    for (const entry of candidatePdfjsEntries()) {
      if (!entry || tried.includes(entry)) continue;
      tried.push(entry);
      try {
        await fs.promises.access(entry, fs.constants.R_OK);
      } catch {
        continue;
      }
      const mod = await import(pathToFileURL(entry).href);
      const fonts = path.join(path.dirname(entry), '..', '..', '..', 'standard_fonts') + path.sep;
      try {
        await fs.promises.access(fonts, fs.constants.R_OK);
        standardFontDataUrl = fonts;
      } catch {}
      return mod;
    }
    throw new Error('缺少 PDF 解析组件 pdfjs-dist，请在插件目录执行 pnpm install 后重试。已尝试：' + tried.join('、'));
  })();
  return pdfjsPromise;
}

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const HEADING_START = /^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.|Abstract\b|Introduction\b|Conclusion\b|References\b|Bibliography\b|Appendix\b|Acknowledg)/;

function normalizeSpace(value) {
  return value
    .replace(/\u00ad/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s+([.,;:!?%])/g, '$1')
    .trim();
}

/** Drop page-number artifacts OCR layers leave inside a text run ("122One might", "dis-123 putants"). */
function stripPageNumberArtifacts(value) {
  return value
    .replace(/^(\d{1,4})(?=[A-Z])/, '')
    .replace(/^(\d{1,4})\s+(?=[A-Z])/, '')
    .replace(/-(\d{1,4})\s+(?=[a-z])/g, '-')
    .trim();
}

function isMostlyNumeric(line) {
  return /^[\d\s.,:;()\-–—]+$/.test(line);
}

function isAllCaps(text) {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length > 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.85;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildGlyphs(items) {
  const glyphs = [];
  for (const item of items) {
    const text = typeof item.str === 'string' ? item.str : '';
    if (!text || !text.trim()) continue;
    const tr = item.transform || [1, 0, 0, 1, 0, 0];
    const height = Math.hypot(tr[2], tr[3]) || item.height || 10;
    glyphs.push({ text, x: tr[4], y: tr[5], h: height, w: item.width || 0 });
  }
  return glyphs;
}

/** One vertical gutter near the middle splits a two-column page; a single-column page keeps one band. */
function columnSplit(glyphs, pageWidth) {
  if (!glyphs.length || !pageWidth) return null;
  const bin = Math.max(1, pageWidth / 200);
  const bins = new Uint8Array(Math.ceil(pageWidth / bin) + 1);
  for (const glyph of glyphs) {
    const from = Math.max(0, Math.floor(glyph.x / bin));
    const to = Math.max(from, Math.floor((glyph.x + Math.max(glyph.w, 0.35 * glyph.h)) / bin));
    for (let i = from; i <= to && i < bins.length; i += 1) bins[i] = 1;
  }
  let best = null;
  let start = -1;
  for (let i = 0; i <= bins.length; i += 1) {
    const empty = i < bins.length && !bins[i];
    if (empty && start < 0) start = i;
    if (!empty && start >= 0) {
      const from = start * bin;
      const to = i * bin;
      if (from > pageWidth * 0.22 && to < pageWidth * 0.78 && to - from > pageWidth * 0.03) {
        if (!best || to - from > best.to - best.from) best = { from, to };
      }
      start = -1;
    }
  }
  return best ? (best.from + best.to) / 2 : null;
}

/**
 * Scanned pages with an OCR layer often place each word on a tilted baseline.
 * Pick the slope that best collapses words into few rows so reading order survives.
 */
function estimateSkew(glyphs) {
  if (glyphs.length < 80) return 0;
  const stride = Math.max(1, Math.ceil(glyphs.length / 900));
  const sample = glyphs.filter((_, index) => index % stride === 0);
  let best = { slope: 0, score: -Infinity };
  for (let step = -15; step <= 15; step += 1) {
    const slope = step * 0.004;
    const bins = new Map();
    for (const glyph of sample) {
      const anchor = glyph.x + Math.max(glyph.w, 0) / 2;
      const key = Math.round((glyph.y - slope * anchor) * 2) / 2;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    let score = 0;
    for (const count of bins.values()) score += count * count;
    if (score > best.score) best = { slope, score };
  }
  return Math.abs(best.slope) < 0.0025 ? 0 : best.slope;
}

/** Cluster glyphs into visual rows by baseline, then order each row left to right. */
function buildLines(glyphs) {
  if (!glyphs.length) return [];
  const slope = estimateSkew(glyphs);
  const tolerance = Math.max(1.6, 0.55 * median(glyphs.map((glyph) => glyph.h)));
  const annotated = glyphs
    .map((glyph) => ({ ...glyph, baseline: glyph.y - slope * glyph.x }))
    .sort((a, b) => a.baseline - b.baseline);
  const clusters = [];
  let current = null;
  for (const glyph of annotated) {
    if (!current || glyph.baseline - current.mean > tolerance) {
      current = { sum: 0, count: 0, mean: 0, glyphs: [] };
      clusters.push(current);
    }
    current.glyphs.push(glyph);
    current.sum += glyph.baseline;
    current.count += 1;
    current.mean = current.sum / current.count;
  }
  const solid = clusters.filter((cluster) => cluster.count >= 2);
  for (const stray of clusters) {
    if (stray.count >= 2) continue;
    let nearest = null;
    let distance = Infinity;
    for (const cluster of solid) {
      const delta = Math.abs(cluster.mean - stray.mean);
      if (delta < distance) {
        distance = delta;
        nearest = cluster;
      }
    }
    if (nearest) nearest.glyphs.push(...stray.glyphs);
  }
  solid.sort((a, b) => b.mean - a.mean);
  return solid.map((cluster) => {
    cluster.glyphs.sort((a, b) => a.x - b.x);
    const height = median(cluster.glyphs.map((glyph) => glyph.h)) || 10;
    let text = '';
    let end = null;
    for (const glyph of cluster.glyphs) {
      if (end !== null) {
        const wideGap = glyph.x - end > Math.max(height * 0.16, 1.0);
        // OCR layers frequently drop the space after sentence punctuation.
        const sentenceBreak = /[.!?]["')\]]?$/.test(text) && /^[A-Z0-9"'(\[]/.test(glyph.text);
        if (wideGap || sentenceBreak) text += ' ';
      }
      text += glyph.text;
      end = Math.max(end ?? glyph.x, glyph.x + glyph.w);
    }
    const left = cluster.glyphs[0].x;
    const right = end ?? left;
    return { baseline: cluster.mean, h: height, text: normalizeSpace(text), left, right };
  }).filter((line) => line.text.length > 0);
}

function collectVocabulary(pagesOfLines) {
  const vocabulary = new Set();
  for (const page of pagesOfLines) {
    for (const column of page.columns) {
      for (const line of column) {
        for (const match of line.text.match(WORD_RE) || []) vocabulary.add(match.toLowerCase());
      }
    }
  }
  return vocabulary;
}

/** Join wrapped lines, deciding hyphenation with the document's own vocabulary. */
function joinWrapped(previous, next, vocabulary) {
  if (/([A-Za-z])-$/.test(previous)) {
    const head = previous.slice(0, -1);
    const firstOfTail = /^[A-Za-z]+/.exec(next);
    if (firstOfTail) {
      const lastOfHead = /([A-Za-z]+)$/.exec(head);
      const merged = (lastOfHead ? lastOfHead[1] + firstOfTail[0] : '').toLowerCase();
      const hyphenated = (lastOfHead ? lastOfHead[1] + '-' + firstOfTail[0] : '').toLowerCase();
      if (merged && vocabulary.has(merged) && !vocabulary.has(hyphenated)) return head + next;
      if (hyphenated && vocabulary.has(hyphenated)) return previous + next;
      if (/^[a-z]/.test(next)) return head + next;
      return previous + next;
    }
    return previous + next;
  }
  if (previous.endsWith('—')) return previous + next;
  return previous ? previous + ' ' + next : next;
}

function medianLineSpacing(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) gaps.push(lines[i - 1].baseline - lines[i].baseline);
  return median(gaps.filter((gap) => gap > 0));
}

function toParagraphs(lines, vocabulary) {
  if (!lines.length) return [];
  const spacing = medianLineSpacing(lines) || 0;
  toParagraphs.baseLeft = Math.min(...lines.map((line) => line.left));
  const blocks = [];
  let current = '';
  let currentLines = [];
  let previous = null;
  const flush = () => {
    const text = stripPageNumberArtifacts(normalizeSpace(current));
    if (text) blocks.push({ text, lines: currentLines });
    current = '';
    currentLines = [];
  };
  for (const line of lines) {
    if (!current) {
      current = line.text;
      currentLines = [line];
      previous = line;
      continue;
    }
    const gap = previous.baseline - line.baseline;
    // A real paragraph ends with terminal punctuation; a large visual gap without one is a layout artifact.
    const terminal = /[.:!?;)\]]$/.test(previous.text.trim());
    const bigGap = (gap > Math.max(spacing * 1.45, previous.h * 1.45) && terminal)
      || (isAllCaps(previous.text) && previous.text.length < 110);
    const indented = line.left > toParagraphs.baseLeft + line.h * 0.62;
    const heading = (line.h > previous.h * 1.16 || HEADING_START.test(line.text) || isAllCaps(line.text))
      && line.text.length < 110
      && !/[a-z],$/.test(line.text);
    // A drop in font size marks the footnote area; keep notes as their own paragraph.
    const fontShrink = line.h < previous.h * 0.86 && previous.h >= 9;
    if (bigGap || heading || fontShrink || (indented && /[.:!?]"?$/.test(previous.text))) {
      flush();
      current = line.text;
      currentLines = [line];
    } else {
      current = joinWrapped(current, line.text, vocabulary);
      currentLines.push(line);
    }
    previous = line;
  }
  if (current) flush();
  return blocks;
}

function dropDecorations(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.length <= 90) counts.set(paragraph, (counts.get(paragraph) || 0) + 1);
    }
  }
  const repeated = new Set();
  for (const [text, count] of counts) if (count >= 3) repeated.add(text);
  for (const page of pages) {
    page.paragraphs = page.paragraphs.filter((paragraph) => !repeated.has(paragraph) && !isMostlyNumeric(paragraph));
  }
}

function pdfDate(value) {
  const match = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(value || '');
  if (!match) return undefined;
  return `${match[1]}-${match[2] || '01'}-${match[3] || '01'}`;
}

export function parsePageRange(spec, totalPages) {
  const raw = String(spec ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all' || raw === '全部') {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set();
  for (const part of raw.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error('页码范围格式不正确，请填写 全部、1-5 或 1,3,5-8。');
    const from = Number(match[1]);
    const to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to > totalPages) throw new Error(`页码范围超出文档页数（共 ${totalPages} 页）。`);
    for (let page = from; page <= to; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Extract selected pages as paragraphs.
 * @returns {{ pages: {page:number, paragraphs:string[], chars:number}[], totalPages:number, title?:string, scanned:boolean }}
 */
export async function extractPdf(file, options = {}) {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await fs.promises.readFile(file));
  const loading = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  });
  const doc = await loading.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info || {};
    const selected = options.pages && options.pages.length
      ? options.pages
      : Array.from({ length: doc.numPages }, (_, index) => index + 1);
    const collected = [];
    for (const pageNumber of selected) {
      if (pageNumber < 1 || pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const glyphs = buildGlyphs(content.items);
      const split = columnSplit(glyphs, viewport.width);
      const bands = split
        ? [glyphs.filter((glyph) => glyph.x + glyph.w / 2 < split), glyphs.filter((glyph) => glyph.x + glyph.w / 2 >= split)]
        : [glyphs];
      collected.push({ page: pageNumber, width: viewport.width, height: viewport.height, columns: bands.map((band) => buildLines(band)) });
      page.cleanup();
      options.onPage?.({ page: pageNumber, done: collected.length, total: selected.length });
    }
    const vocabulary = collectVocabulary(collected);
    const pages = collected.map((entry) => {
      const blocks = [];
      for (const column of entry.columns) blocks.push(...toParagraphs(column, vocabulary));
      const paragraphs = blocks.map((block) => block.text);
      const chars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
      return { page: entry.page, width: entry.width, height: entry.height, blocks, paragraphs, chars };
    });
    dropDecorations(pages);
    const chars = pages.reduce((sum, page) => sum + page.chars, 0);
    return {
      pages,
      totalPages: doc.numPages,
      title: typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : undefined,
      created: pdfDate(info.CreationDate),
      producer: typeof info.Producer === 'string' ? info.Producer : undefined,
      chars,
      scanned: chars < Math.max(120, pages.length * 60),
    };
  } finally {
    await loading.destroy().catch(() => {});
  }
}

// Exported for unit tests only.
export const __testing = { buildGlyphs, buildLines, columnSplit, toParagraphs, joinWrapped };

/** Cheap metadata probe: page count and title without extracting text. */
export async function pdfInfo(file) {
  const stat = await fs.promises.stat(file);
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await fs.promises.readFile(file));
  const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  const doc = await loading.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const title = typeof meta?.info?.Title === 'string' ? meta.info.Title.trim() : '';
    return { path: file, bytes: stat.size, pages: doc.numPages, title: title || undefined };
  } finally {
    await loading.destroy().catch(() => {});
  }
}
