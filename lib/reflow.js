// Reflowed output: rebuild the article as a real DOCX (title, body paragraphs, Word footnotes),
// then let the bundled LibreOffice convert it to PDF. Typography replaces the original layout.
import {
  AlignmentType, Document, Footer, FootnoteReferenceRun, LineRuleType, Packer, PageNumber, Paragraph, TextRun,
} from 'docx';

const FONT = { ascii: 'Times New Roman', eastAsia: 'Songti SC', hAnsi: 'Times New Roman', cs: 'Times New Roman' };
const BODY_SIZE = 22; // half-points: 11pt
const TITLE_SIZE = 36; // 18pt
const NOTE_SIZE = 18; // 9pt

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Normalize spacing around CJK punctuation and collapse OCR whitespace. */
export function cleanupText(text, { note = false } = {}) {
  let value = String(text || '')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。；：！？、）」』】》%])/g, '$1')
    .replace(/([（「『【《])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\*+/g, '')
    .trim();
  // Word numbers footnotes by itself; drop the original marker digit from the note text.
  if (note) value = value.replace(/^([0-9]{1,3})\s*[.、)]?\s*(?=\S)/, '').trim();
  return value;
}

function findTitleCandidate(pages) {
  for (const page of pages.slice(0, 4)) {
    for (const block of page.blocks) {
      const match = /((?:[A-Z][A-Z'’\-]{1,}\s+){3,}[A-Z][A-Z'’\-]{1,})/.exec(block.text || '');
      if (match) {
        const value = match[1].replace(/\s+/g, ' ').trim();
        if (value.length >= 12 && value.length <= 160) return value;
      }
    }
  }
  return undefined;
}

/**
 * Decide what becomes a paragraph and what becomes a footnote.
 * @param {Array} pages extracted pages (with width/height/blocks)
 * @param {Map<number, Array>} byPage translated blocks per page
 */
export function planReflow(pages, byPage) {
  const heights = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) heights.push(line.h);
    }
  }
  const bodySize = median(heights) || 10;
  const firstPage = pages[0]?.page;
  const blocks = [];
  let skippedPages = [];
  for (const page of pages) {
    const pageHeight = page.height || 800;
    const rawText = page.blocks.map((block) => block.text).join(' ');
    const isCover = page.page === firstPage && /jstor|terms and conditions|reviewed work|source:/i.test(rawText);
    if (isCover) {
      skippedPages.push(page.page);
      continue;
    }
    for (const block of byPage.get(page.page) || []) {
      if (!block.dst || !block.dst.trim() || !block.lines?.length) continue;
      const h = median(block.lines.map((line) => line.h));
      const top = Math.max(...block.lines.map((line) => line.baseline + line.h * 0.9));
      if (top > pageHeight * 0.9 && h <= bodySize * 1.02 && block.lines.length <= 2) continue; // running head
      const isNote = h <= bodySize * 0.9 && top < pageHeight * 0.55;
      const text = cleanupText(block.dst, { note: isNote });
      if (!text || /^\d{1,4}$/.test(text)) continue;
      blocks.push({ page: page.page, kind: isNote ? 'note' : 'body', text, size: h });
    }
  }

  const byNumber = new Map();
  for (const block of blocks) {
    if (!byNumber.has(block.page)) byNumber.set(block.page, { page: block.page, body: [], notes: [] });
    const entry = byNumber.get(block.page);
    if (block.kind === 'note') entry.notes.push(block.text);
    else entry.body.push(block.text);
  }
  const body = [...byNumber.values()].filter((entry) => entry.body.length || entry.notes.length);
  // Notes without their own body paragraph attach to the previous page's text.
  let previous = null;
  for (const entry of body) {
    if (entry.body.length) previous = entry;
    else if (previous) {
      previous.notes.push(...entry.notes);
      entry.notes = [];
    }
  }
  const pagesWithText = body.filter((entry) => entry.body.length);
  const notes = body.reduce((sum, entry) => sum + entry.notes.length, 0);
  return {
    titleCandidate: findTitleCandidate(pages),
    bodySize,
    body: pagesWithText,
    stats: {
      pages: pagesWithText.length,
      paragraphs: pagesWithText.reduce((sum, entry) => sum + entry.body.length, 0),
      notes,
      skippedPages,
      bodySize,
    },
  };
}

/**
 * Build the DOCX bytes. Notes become real Word footnotes anchored at the end of their page's last paragraph.
 */
export async function buildDocxBytes(input) {
  const { title, subtitle, body, createdAt, modelLabel } = input;
  const children = [
    new Paragraph({
      children: [new TextRun({ text: title, size: TITLE_SIZE, bold: true, font: FONT })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 200 },
    }),
  ];
  if (subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: subtitle, size: 20, font: FONT, color: '666666' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
    }));
  }
  for (const entry of body) {
    entry.body.forEach((text, index) => {
      const runs = [new TextRun({ text, size: BODY_SIZE, font: FONT })];
      if (index === entry.body.length - 1 && entry.notes.length) {
        for (const note of entry.notes) {
          runs.push(new FootnoteReferenceRun({
            children: [new Paragraph({ children: [new TextRun({ text: note, size: NOTE_SIZE, font: FONT })] })],
          }));
        }
      }
      children.push(new Paragraph({
        children: runs,
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: 440 },
        spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 80 },
      }));
    });
  }
  if (createdAt || modelLabel) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: [modelLabel ? `机器翻译：${modelLabel}` : '', createdAt ? `生成于 ${createdAt}` : ''].filter(Boolean).join(' · '),
        size: 16,
        color: '999999',
        font: FONT,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 480 },
    }));
  }

  const doc = new Document({
    creator: 'pdf-translator-mac',
    title,
    description: 'PDF 翻译（重排版）',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 in twips
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: FONT, color: '888888' })],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

/** Convert DOCX bytes to PDF with the Host Office service (bundled LibreOffice). */
export async function convertDocxToPdf(ctx, bytes, options = {}) {
  const service = ctx.get('officeToPdf');
  if (!service?.convert) {
    throw new Error('当前 Harness 没有启用 Office 转 PDF 服务（officeToPdf），无法生成重排 PDF。');
  }
  const result = await service.convert({
    extension: 'docx',
    priority: 'foreground',
    source: {
      key: options.key || `pdf-translator-mac-${Date.now()}`,
      version: '1',
      bytes: bytes.length,
      read: async () => ({ bytes: new Uint8Array(bytes), version: '1' }),
    },
  }, options.signal);
  if (!result?.pdf || result.pdf.length < 100) throw new Error('Office 转 PDF 返回了空结果。');
  return result.pdf;
}
