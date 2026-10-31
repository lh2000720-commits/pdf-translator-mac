// Translation task manager: one active task, progress, persistence, native macOS dialogs.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractPdf, parsePageRange, pdfInfo } from './pdf-text.js';
import { LlmClient } from './llm.js';
import { TranslationCache, translatePages } from './translate.js';
import { writeDocuments, writeReport } from './render.js';
import { writeOverlayPdf } from './pdf-overlay.js';

const ACTIVE_STATUSES = new Set(['queued', 'extracting', 'translating', 'writing', 'cancelling']);
const PHASE_LABELS = {
  queued: '排队中',
  extract: '解析 PDF',
  translating: '翻译',
  writing: '生成文件',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  cancelling: '正在取消',
};

const PICK_FILE_SCRIPT = `
on run argv
  set startPath to item 1 of argv
  try
    set target to choose file with prompt "选择要翻译的 PDF" of type {"pdf"} default location (POSIX file startPath)
  on error number -128
    return "CANCELLED"
  end try
  return POSIX path of target
end run`;

const PICK_FOLDER_SCRIPT = `
on run argv
  set startPath to item 1 of argv
  try
    set target to choose folder with prompt "选择输出目录" default location (POSIX file startPath)
  on error number -128
    return "CANCELLED"
  end try
  return POSIX path of target
end run`;

export class TranslationManager {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config || {};
    this.dataDir = path.resolve(this.config.dataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'pdf-translator-mac'));
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.cache = new TranslationCache(path.join(this.dataDir, 'cache.json'), Number(this.config.cacheEntries) || 4000);
    this.llm = new LlmClient(ctx, this.config);
    this.defaults = {
      outputDir: '',
      mode: 'bilingual',
      language: '中文',
      output: 'both',
      lastDir: '',
    };
    this.tasks = [];
    this.active = null;
    this.controllers = new Set();
    this.waiters = new Map();
    this.persistTimer = null;
    this.closed = false;
    this.ready = this.load();
    this.ready.catch(() => {});
  }

  async load() {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await this.cache.load();
    try {
      const state = JSON.parse(await fs.promises.readFile(this.stateFile, 'utf8'));
      if (state?.defaults && typeof state.defaults === 'object') this.defaults = { ...this.defaults, ...state.defaults };
      if (Array.isArray(state?.tasks)) {
        this.tasks = state.tasks.map((task) => (ACTIVE_STATUSES.has(task.status)
          ? { ...task, status: 'interrupted', error: 'Harness 重启导致任务中断，重新运行会复用已翻译的段落。', finishedAt: Date.now() }
          : task));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = error.message;
    }
  }

  settle(task) {
    const waiters = this.waiters.get(task.id) || [];
    this.waiters.delete(task.id);
    for (const resolve of waiters) resolve(task);
  }

  async persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, 350);
    this.persistTimer.unref?.();
  }

  async flush() {
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      defaults: this.defaults,
      tasks: this.tasks.slice(-20),
    }, null, 2);
    await fs.promises.mkdir(path.dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    await fs.promises.writeFile(temp, payload, 'utf8');
    await fs.promises.rename(temp, this.stateFile);
  }

  modelInfo() {
    try {
      const route = this.llm.route();
      return { provider: route.provider, model: route.model, label: route.label, effort: this.llm.effort || '' };
    } catch (error) {
      return { provider: '', model: '', label: '', error: error.message };
    }
  }

  async status() {
    await this.ready;
    await this.llm.chooseEffort().catch(() => {});
    return {
      ok: true,
      defaults: this.defaults,
      model: this.modelInfo(),
      cache: { entries: this.cache.entries.size },
      active: this.active ? this.active.id : null,
      tasks: [...this.tasks].slice(-20).reverse(),
      platform: process.platform,
      dataDir: this.dataDir,
    };
  }

  async inspect(file) {
    await this.ready;
    const target = this.resolveInput(file);
    const info = await pdfInfo(target);
    if (!info.pages) throw new Error('这个 PDF 没有可读取的页面。');
    this.defaults.lastDir = path.dirname(target);
    void this.persist();
    return { ...info, ok: true };
  }

  resolveInput(file) {
    const raw = String(file || '').trim();
    if (!raw) throw new Error('请先选择 PDF 文件。');
    const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
    if (!path.isAbsolute(expanded)) throw new Error('请填写 PDF 的绝对路径。');
    let stat;
    try {
      stat = fs.statSync(expanded);
    } catch {
      throw new Error('找不到这个文件，请确认路径是否正确。');
    }
    if (!stat.isFile()) throw new Error('这个路径不是文件。');
    if (!/\.pdf$/i.test(expanded)) throw new Error('目前只支持 PDF 文件。');
    try {
      fs.accessSync(expanded, fs.constants.R_OK);
    } catch {
      throw new Error('没有读取这个文件的权限。');
    }
    return path.resolve(expanded);
  }

  async saveDefaults(patch = {}) {
    await this.ready;
    if (typeof patch.mode === 'string' && ['bilingual', 'translated'].includes(patch.mode)) this.defaults.mode = patch.mode;
    if (typeof patch.output === 'string' && ['both', 'pdf', 'web'].includes(patch.output)) this.defaults.output = patch.output;
    if (typeof patch.language === 'string' && patch.language.trim()) this.defaults.language = patch.language.trim().slice(0, 40);
    if (typeof patch.outputDir === 'string') {
      const value = patch.outputDir.trim();
      this.defaults.outputDir = value ? path.resolve(value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value) : '';
    }
    if (typeof patch.lastDir === 'string' && patch.lastDir) this.defaults.lastDir = patch.lastDir;
    await this.persist();
    return { ok: true, defaults: this.defaults };
  }

  async start(input = {}) {
    await this.ready;
    if (this.closed) throw new Error('插件正在关闭。');
    if (this.active) throw new Error('已有一个翻译任务在运行，请等待完成或先取消。');
    const file = this.resolveInput(input.pdf);
    const info = await pdfInfo(file);
    const selectedPages = parsePageRange(input.pages, info.pages);
    if (selectedPages.length > (Number(this.config.maxPages) || 120)) {
      throw new Error(`一次最多翻译 ${Number(this.config.maxPages) || 120} 页，请先指定页码范围。`);
    }
    if (input.mode && !['bilingual', 'translated'].includes(input.mode)) throw new Error('输出模式无效。');
    if (input.output && !['both', 'pdf', 'web'].includes(input.output)) throw new Error('输出格式无效。');
    const language = String(input.language || this.defaults.language || '中文').trim().slice(0, 40) || '中文';
    const mode = input.mode || this.defaults.mode || 'bilingual';
    const output = input.output || this.defaults.output || 'both';
    const baseName = path.basename(file, path.extname(file));
    const outputRoot = path.resolve(
      (input.outputDir || this.defaults.outputDir || path.dirname(file)).replace(/^~/, os.homedir()),
    );
    await fs.promises.mkdir(outputRoot, { recursive: true });
    const folder = path.join(outputRoot, `${baseName}-翻译`);
    const task = {
      id: `pt-${crypto.randomBytes(4).toString('hex')}`,
      pdf: file,
      name: path.basename(file),
      folder,
      outputDir: outputRoot,
      totalPages: info.pages,
      selectedPages,
      mode,
      language,
      output,
      title: info.title || baseName,
      status: 'queued',
      phase: 'queued',
      progress: { phase: 'queued', label: PHASE_LABELS.queued, done: 0, total: selectedPages.length },
      createdAt: Date.now(),
      startedAt: Date.now(),
      warnings: [],
    };
    this.tasks.push(task);
    if (this.tasks.length > 30) this.tasks = this.tasks.slice(-30);
    const controller = new AbortController();
    this.controllers.add(controller);
    task.controller = controller;
    this.active = task;
    void this.persist();
    this.run(task, controller, info).finally(() => {
      this.controllers.delete(controller);
      if (this.active === task) this.active = null;
      delete task.controller;
      this.settle(task);
      void this.persist();
    });
    return { ok: true, task: this.publicTask(task) };
  }

  publicTask(task) {
    const { controller, ...rest } = task;
    return { ...rest, phaseLabel: PHASE_LABELS[rest.phase] || rest.phase };
  }

  updateProgress(task, patch) {
    task.progress = { ...task.progress, ...patch, label: PHASE_LABELS[patch.phase || task.progress?.phase] || patch.label };
  }

  async run(task, controller, info) {
    const started = Date.now();
    try {
      task.status = 'extracting';
      this.updateProgress(task, { phase: 'extract', done: 0, total: task.selectedPages.length, page: task.selectedPages[0] });
      const extracted = await extractPdf(task.pdf, {
        pages: task.selectedPages,
        onPage: (page) => this.updateProgress(task, { phase: 'extract', done: page.done, total: page.total, page: page.page }),
      });
      controller.signal.throwIfAborted();
      if (extracted.chars < 40 || extracted.pages.every((page) => page.chars === 0)) {
        throw new Error('这个 PDF 没有可提取的文字层（多半是扫描件）。请换用带文字层的 PDF，或先用 OCR 工具处理后再翻译。');
      }
      if (extracted.scanned) task.warnings.push('文档文字很少，可能有扫描页未被翻译。');
      task.title = task.title || extracted.title || path.basename(task.pdf, '.pdf');
      task.detected = { chars: extracted.chars, title: extracted.title, producer: extracted.producer };

      task.status = 'translating';
      this.updateProgress(task, { phase: 'translating', done: 0, total: 1, page: task.selectedPages[0] });
      const route = this.llm.route();
      const { byPage, stats } = await translatePages({
        pages: extracted.pages,
        language: task.language,
        llm: this.llm,
        cache: this.cache,
        modelKey: `${route.provider}/${route.model}`,
        concurrency: Number(this.config.concurrency) || 3,
        maxChunkChars: Number(this.config.maxChunkChars) || 1800,
        signal: controller.signal,
        onProgress: (progress) => this.updateProgress(task, { phase: 'translating', done: progress.done, total: progress.total, page: progress.page }),
      });
      controller.signal.throwIfAborted();
      if (stats.chunks > 0 && stats.failed >= stats.chunks) {
        throw new Error(stats.failures[0]?.error || '所有段落都翻译失败，请检查模型配置。');
      }
      if (stats.failed) task.warnings.push(`${stats.failed} 个段落翻译失败，可重新运行以续译。`);

      task.status = 'writing';
      this.updateProgress(task, { phase: 'writing', done: stats.chunks, total: stats.chunks });
      const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, blocks]) => ({ page, blocks }));
      const createdAt = new Date().toLocaleString('zh-CN', { hour12: false });
      const baseName = path.basename(task.pdf, '.pdf');
      const wantWeb = task.output !== 'pdf';
      const wantPdf = task.output !== 'web';
      const documentInput = {
        title: task.title,
        source: task.pdf,
        language: task.language,
        mode: task.mode,
        modelLabel: route.label,
        createdAt,
        pages,
        totalPages: task.totalPages,
        stats,
      };
      const outputs = wantWeb ? await writeDocuments(task.folder, baseName, documentInput) : {};
      let pdf = null;
      if (wantPdf) {
        try {
          pdf = await writeOverlayPdf({
            sourcePath: task.pdf,
            outputPath: path.join(task.folder, `${baseName}.zh.pdf`),
            pages,
            title: task.title,
            config: { ...this.config, dataDir: this.dataDir },
          });
          outputs.pdf = pdf.path;
          if (pdf.skippedPages.length) task.warnings.push(`第 ${pdf.skippedPages.join('、')} 页是旋转页或被裁切，PDF 版式未覆盖，可看网页版。`);
        } catch (error) {
          task.warnings.push(`原版式 PDF 生成失败：${error.message}${wantWeb ? '（网页版译文仍可用）' : '，已改为输出网页版译文。'}`);
          if (!wantWeb) Object.assign(outputs, await writeDocuments(task.folder, baseName, documentInput));
        }
      }
      const report = {
        version: 1,
        title: task.title,
        source: task.pdf,
        language: task.language,
        mode: task.mode,
        model: route.label,
        createdAt,
        pages: pages.map((page) => ({ page: page.page, paragraphs: page.blocks.length })),
        totalPages: task.totalPages,
        stats,
        pdf,
        outputs,
      };
      outputs.report = await writeReport(task.folder, report);
      task.outputs = outputs;
      task.overlay = pdf ? { pages: pdf.pages, blocks: pdf.blocks, font: pdf.font, bytes: pdf.bytes } : null;
      task.stats = { ...stats, elapsedMs: Date.now() - started, usage: stats.usage };
      task.status = 'completed';
      this.updateProgress(task, { phase: 'completed', done: stats.chunks, total: stats.chunks });
      task.finishedAt = Date.now();
    } catch (error) {
      const aborted = controller.signal.aborted || error?.name === 'AbortError';
      task.status = aborted ? 'cancelled' : 'failed';
      task.error = aborted
        ? '已取消。已翻译的段落保存在缓存里，重新运行会从中断处继续。'
        : (error?.message || String(error));
      task.finishedAt = Date.now();
      this.updateProgress(task, { phase: aborted ? 'cancelled' : 'failed', done: task.progress?.done || 0, total: task.progress?.total || task.selectedPages.length });
      if (!aborted) this.ctx.get('console')?.error?.('[pdf-translator-mac] task failed', error);
    } finally {
      await this.cache.flush().catch(() => {});
    }
  }

  async wait(id, timeoutMs = 0) {
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('找不到这个任务。');
    if (!ACTIVE_STATUSES.has(task.status)) return this.publicTask(task);
    return new Promise((resolve) => {
      const list = this.waiters.get(id) || [];
      list.push((settled) => resolve(this.publicTask(settled)));
      this.waiters.set(id, list);
      if (timeoutMs > 0) {
        const timer = setTimeout(() => resolve(this.publicTask(task)), timeoutMs);
        timer.unref?.();
      }
    });
  }

  async cancel(id) {
    await this.ready;
    const task = this.tasks.find((candidate) => candidate.id === id) || this.active;
    if (!task || !ACTIVE_STATUSES.has(task.status)) return { ok: true, cancelled: false, task: task ? this.publicTask(task) : null };
    task.status = 'cancelling';
    this.updateProgress(task, { phase: 'cancelling' });
    task.controller?.abort();
    return { ok: true, cancelled: true, task: this.publicTask(task) };
  }

  async open(id, kind = 'html') {
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('找不到这个任务。');
    const targets = {
      pdf: task.outputs?.pdf,
      html: task.outputs?.html,
      markdown: task.outputs?.markdown,
      text: task.outputs?.text,
      report: task.outputs?.report,
      folder: task.folder,
    };
    const target = targets[kind];
    if (!target) throw new Error('这个任务还没有对应的结果文件。');
    await this.openPath(target, kind === 'folder');
    return { ok: true, opened: target };
  }

  async openPath(target, reveal = false) {
    const controller = this.ctx.get('sessionController');
    if (controller?.openWorkspacePath) {
      try {
        await controller.openWorkspacePath(reveal ? { path: target, action: 'reveal' } : { path: target }, new AbortController().signal);
        return;
      } catch {}
    }
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/open', [target], (error) => (error ? reject(new Error('无法打开这个文件。')) : resolve()));
    });
  }

  async listDir(dir) {
    await this.ready;
    const requested = dir ? String(dir).trim() : (this.defaults.lastDir || os.homedir());
    const expanded = requested.startsWith('~') ? path.join(os.homedir(), requested.slice(1)) : requested;
    const target = path.resolve(expanded || os.homedir());
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) {
        items.push({ name: entry.name, path: full, type: 'dir' });
      } else if (/\.pdf$/i.test(entry.name)) {
        let size = 0;
        try {
          size = (await fs.promises.stat(full)).size;
        } catch {}
        items.push({ name: entry.name, path: full, type: 'pdf', size });
      }
      if (items.length >= 400) break;
    }
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1));
    this.defaults.lastDir = target;
    void this.persist();
    return {
      ok: true,
      path: target,
      parent: path.dirname(target) === target ? null : path.dirname(target),
      home: os.homedir(),
      entries: items,
    };
  }

  async pick(kind) {
    if (process.platform !== 'darwin') throw new Error('系统选择窗口只支持 macOS，请直接输入路径。');
    if (!['pdf', 'directory'].includes(kind)) throw new Error('不支持的选择类型。');
    const startDir = this.defaults.lastDir || os.homedir();
    const script = kind === 'pdf' ? PICK_FILE_SCRIPT : PICK_FOLDER_SCRIPT;
    const output = await new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/osascript', ['-e', script, startDir], { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
          if (String(stderr || '').includes('-128') || error.killed) resolve('CANCELLED');
          else reject(new Error('无法打开系统选择窗口，可以直接输入路径。'));
          return;
        }
        resolve(String(stdout || '').trim());
      });
      child.on('error', () => reject(new Error('无法打开系统选择窗口。')));
    });
    if (!output || output === 'CANCELLED') return { ok: true, cancelled: true };
    const chosen = kind === 'pdf' ? output : output;
    this.defaults.lastDir = kind === 'pdf' ? path.dirname(chosen) : chosen;
    if (kind === 'directory') this.defaults.outputDir = chosen;
    await this.persist();
    return { ok: true, cancelled: false, path: chosen };
  }

  async dispose() {
    this.closed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    await Promise.allSettled([this.cache.dispose(), this.flush()]);
  }
}
