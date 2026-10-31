// Chunk planning, caching and model-driven translation of extracted pages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROMPT_VERSION = 'mac-v3';
const PARA_DELIMITER = '<<<PARA>>>';

export function splitLongParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]?|$)/g) || [paragraph];
  const pieces = [];
  let buffer = '';
  for (const sentence of sentences) {
    if (buffer && buffer.length + sentence.length > maxChars) {
      pieces.push(buffer.trim());
      buffer = '';
    }
    if (sentence.length > maxChars) {
      if (buffer) {
        pieces.push(buffer.trim());
        buffer = '';
      }
      for (let index = 0; index < sentence.length; index += maxChars) {
        pieces.push(sentence.slice(index, index + maxChars).trim());
      }
      continue;
    }
    buffer += sentence;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces.filter(Boolean);
}

/**
 * Group page paragraphs into model-sized chunks that never span a page boundary.
 * Each chunk keeps the source block index and its line geometry so the PDF writer can put
 * the translation back where the original text was.
 */
export function planChunks(pages, maxChars) {
  const chunks = [];
  for (const page of pages) {
    const sourceBlocks = Array.isArray(page.blocks)
      ? page.blocks
      : (page.paragraphs || []).map((text) => ({ text, lines: [] }));
    let buffer = [];
    let size = 0;
    const flush = () => {
      if (!buffer.length) return;
      chunks.push({
        page: page.page,
        blocks: buffer,
        paragraphs: buffer.map((block) => block.text),
        text: buffer.map((block) => block.text).join(`\n\n${PARA_DELIMITER}\n\n`),
      });
      buffer = [];
      size = 0;
    };
    sourceBlocks.forEach((block, index) => {
      const text = String(block.text || '').trim();
      if (!text) return;
      if (size + text.length > maxChars && buffer.length) flush();
      buffer.push({ index, text, lines: block.lines || [] });
      size += text.length + 2;
      if (text.length > maxChars) flush();
    });
    flush();
  }
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

export function cacheKey(language, text, modelKey) {
  return crypto.createHash('sha256').update([PROMPT_VERSION, language, modelKey, text].join('\u0000')).digest('hex').slice(0, 32);
}

const CJK_TARGET = /^(中文|汉语|简体|繁體|繁体|chinese|zh)/i;

export function buildPrompt(chunk, language) {
  return chunk.paragraphs.join(`\n\n${PARA_DELIMITER}\n\n`);
}

export function buildSystemPrompt(language) {
  return [
    `你是一名严谨的学术文档译者，负责把英文文档译成${language}。`,
    '输出规则：',
    `1. 输入段落之间用 ${PARA_DELIMITER} 分隔；输出的段数、顺序必须与输入完全一致，并且用完全相同的 ${PARA_DELIMITER} 分隔（不要加反引号、编号或其它标记）。`,
    '2. 只输出译文本身：不要前言、说明、标题、编号，也不要重复原文。',
    '3. 数字、年份、文献引用（如 [3]、p. 12、1989）、人名、缩写、公式与符号保持原样；专业术语用该领域通行译法，必要时首次出现可在括号内保留英文原词。',
    '4. 图表标题、脚注、参考文献也照常翻译，不合并、不省略、不添加原文没有的内容。',
    '5. 语气与原文一致：准确、通顺、学术化，避免口语化与过度意译。',
    '6. 输入中若有明显的换行断词或 OCR 造成的粘连，按语义恢复成正常的词与句。',
  ].join('\n');
}

function cleanParagraph(value) {
  return value
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^\s*(?:译文|翻译)\s*[:：]\s*/, '')
    .replace(/\r/g, '')
    .trim();
}

export function parseTranslation(text, expectedParagraphs) {
  const raw = String(text || '');
  const splitDelimiter = (value) => value.split(/\n*\s*`?\s*<<<PARA>>>\s*`?\s*\n*/);
  let parts = splitDelimiter(raw).map(cleanParagraph).filter(Boolean);
  if (parts.length === 1 && expectedParagraphs > 1) {
    // The model dropped the delimiter: fall back to blank lines before giving up on alignment.
    const byBlankLine = raw.split(/\n\s*\n/).map(cleanParagraph).filter(Boolean);
    if (byBlankLine.length === expectedParagraphs) parts = byBlankLine;
  }
  return {
    paragraphs: parts,
    aligned: parts.length === expectedParagraphs && expectedParagraphs > 0,
  };
}

export class TranslationCache {
  constructor(file, limit = 4000) {
    this.file = file;
    this.limit = limit;
    this.entries = new Map();
    this.dirty = false;
    this.timer = null;
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      for (const [key, value] of Object.entries(raw?.entries || {})) {
        if (value && typeof value.text === 'string') this.entries.set(key, value);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = error.message;
    }
    return this;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.at = Date.now();
    return entry;
  }

  set(key, text, model) {
    this.entries.set(key, { text, at: Date.now(), model });
    if (this.entries.size > this.limit) {
      const sorted = [...this.entries.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
      for (const [oldKey] of sorted.slice(0, this.entries.size - this.limit)) this.entries.delete(oldKey);
    }
    this.dirty = true;
    this.schedule();
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 1200);
    this.timer.unref?.();
  }

  async flush() {
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      entries: Object.fromEntries(this.entries),
    });
    this.writing = this.writing.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      await fs.promises.writeFile(temp, payload, 'utf8');
      await fs.promises.rename(temp, this.file);
    });
    return this.writing;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.flush();
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function snapshotUsage(usage, stats) {
  if (!usage) return;
  stats.usage.input += usage.inputTokens || 0;
  stats.usage.output += usage.outputTokens || 0;
  stats.usage.cached += usage.cacheReadTokens || 0;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('翻译已取消。'), { name: 'AbortError' }));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
});

/**
 * Translate every planned chunk, then reassemble per-page blocks.
 * @returns {Promise<{ byPage: Map<number, {src:string,dst:string,aligned:boolean}[]>, stats: object }>}
 */
export async function translatePages(options) {
  const {
    pages, language, llm, cache, modelKey, concurrency = 3, maxChunkChars = 1800, signal, onProgress, onCacheHit,
  } = options;
  const chunks = planChunks(pages, maxChunkChars);
  const system = buildSystemPrompt(language);
  const cjk = CJK_TARGET.test(language);
  const stats = {
    chunks: chunks.length,
    cached: 0,
    failed: 0,
    usage: { input: 0, output: 0, cached: 0 },
    failures: [],
  };
  let done = 0;

  // Output budget must cover the translation plus any reasoning tokens the model spends first.
  const maxTokensFor = (text) => Math.min(8192, Math.max(1600, Math.ceil(text.length * (cjk ? 2.2 : 1.6)) + 1500));

  function splitForRetry(chunk) {
    if (chunk.blocks.length > 1) {
      const half = Math.ceil(chunk.blocks.length / 2);
      return [chunk.blocks.slice(0, half), chunk.blocks.slice(half)].map((blocks) => ({
        ...chunk,
        blocks,
        paragraphs: blocks.map((block) => block.text),
        text: blocks.map((block) => block.text).join(`\n\n${PARA_DELIMITER}\n\n`),
      }));
    }
    const block = chunk.blocks[0];
    const pieces = splitLongParagraph(block.text, Math.max(400, Math.ceil(block.text.length / 2)));
    if (pieces.length < 2) return [];
    return pieces.map((piece) => ({
      ...chunk,
      blocks: [{ ...block, text: piece }],
      paragraphs: [piece],
      text: piece,
    }));
  }

  async function callModel(chunk) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signal?.throwIfAborted();
      try {
        const result = await llm.complete({
          system,
          prompt: buildPrompt(chunk, language),
          maxTokens: maxTokensFor(chunk.text),
          signal,
        });
        snapshotUsage(result.usage, stats);
        return result;
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        lastError = error;
        await sleep(900 * (attempt + 1), signal);
      }
    }
    throw lastError || new Error('模型调用失败。');
  }

  async function translateChunk(chunk, depth = 0) {
    const key = cacheKey(language, chunk.text, modelKey);
    const cached = cache.get(key);
    if (cached) {
      stats.cached += 1;
      onCacheHit?.(chunk);
      const parsed = parseTranslation(cached.text, chunk.paragraphs.length);
      if (parsed.paragraphs.length) return parsed;
    }
    const result = await callModel(chunk);
    let parsed = parseTranslation(result.text, chunk.paragraphs.length);
    if (!parsed.paragraphs.length && chunk.paragraphs.length > 1 && depth < 2) {
      // The model answered with nothing usable: translate the paragraphs one at a time.
      const singles = [];
      for (const block of chunk.blocks) {
        singles.push(await translateChunk({ ...chunk, blocks: [block], paragraphs: [block.text], text: block.text }, depth + 1));
      }
      return { paragraphs: singles.flatMap((single) => single.paragraphs), aligned: singles.every((single) => single.aligned) };
    }
    if (!parsed.paragraphs.length && chunk.paragraphs.length === 1) {
      const retry = await llm.complete({
        system: '',
        prompt: `把下面这段文字翻译成${language}。只输出译文，不要解释，不要重复原文。\n\n${chunk.text}`,
        maxTokens: maxTokensFor(chunk.text),
        signal,
      });
      snapshotUsage(retry.usage, stats);
      parsed = parseTranslation(retry.text, 1);
      if (parsed.paragraphs.length) {
        if (parsed.paragraphs.length === 1) cache.set(key, parsed.paragraphs[0], modelKey);
        return parsed;
      }
    }
    if (result.truncated) {
      const parts = depth < 3 ? splitForRetry(chunk) : [];
      if (parts.length > 1) {
        const translated = [];
        for (const part of parts) translated.push(await translateChunk(part, depth + 1));
        if (chunk.paragraphs.length > 1) {
          return {
            paragraphs: translated.flatMap((part) => part.paragraphs),
            aligned: translated.every((part) => part.aligned),
          };
        }
        const joined = translated.map((part) => part.paragraphs.join(cjk ? '' : ' ')).join(cjk ? '' : ' ').trim();
        if (joined) return { paragraphs: [joined], aligned: true };
      }
    }
    if (!parsed.paragraphs.length) throw new Error('模型返回了空译文。');
    if (!result.truncated) cache.set(key, result.text, modelKey);
    return parsed;
  }

  const results = await mapPool(chunks, Math.max(1, Math.min(6, concurrency)), async (chunk) => {
    try {
      const translated = await translateChunk(chunk);
      return { chunk, ...translated };
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      stats.failed += 1;
      stats.failures.push({ page: chunk.page, error: error?.message || String(error) });
      return { chunk, paragraphs: [], aligned: false, error: error?.message || String(error) };
    } finally {
      done += 1;
      onProgress?.({ done, total: chunks.length, page: chunk.page });
    }
  });

  const byPage = new Map();
  for (const page of pages) byPage.set(page.page, []);
  for (const result of results) {
    if (!result) continue;
    const blocks = byPage.get(result.chunk.page) || [];
    const chunkBlocks = result.chunk.blocks;
    if (result.aligned && result.paragraphs?.length === chunkBlocks.length) {
      chunkBlocks.forEach((block, index) => {
        blocks.push({ src: block.text, dst: result.paragraphs[index], aligned: true, lines: block.lines });
      });
    } else {
      blocks.push({
        src: chunkBlocks.map((block) => block.text).join('\n\n'),
        dst: result.paragraphs?.length ? result.paragraphs.join('\n\n') : '',
        aligned: false,
        error: result.error,
        lines: chunkBlocks.flatMap((block) => block.lines || []),
      });
    }
    byPage.set(result.chunk.page, blocks);
  }
  return { byPage, stats };
}
