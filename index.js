// Host half: the PDF translation manager, its agent tools, and the Web panel API.
import { TranslationManager } from './lib/manager.js';
import { registerRoutes } from './lib/routes.js';

export const name = 'pdf-translator-mac';
export const inject = ['tools'];

const string = (description) => ({ type: 'string', description });
const boolean = (description) => ({ type: 'boolean', description });

function tool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object',
      properties: spec.properties,
      ...(spec.required?.length ? { required: spec.required } : {}),
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: spec.execute,
  };
}

/** Tool results must be plain lossless JSON: drop undefined/NaN and non-plain values. */
function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function taskSummary(task) {
  return {
    taskId: task.id,
    status: task.status,
    pdf: task.pdf,
    pages: task.selectedPages?.length,
    totalPages: task.totalPages,
    mode: task.mode,
    language: task.language,
    outputs: task.outputs,
    folder: task.folder,
    error: task.error,
    warnings: task.warnings,
  };
}

export function apply(ctx, config = {}) {
  const manager = new TranslationManager(ctx, config || {});
  ctx.effect(() => () => {
    void manager.dispose();
  });

  ctx.tools.register(tool({
    name: 'pdf_translate',
    description:
      '把本地 PDF 逐页翻译成中文（或指定语言），直接输出保留原版式的 PDF（页面、图片、图表、分栏和页码不变，译文覆盖在原文位置），同时给出中英对照的 HTML、Markdown 和纯文本。'
      + '直接使用当前登录的 DeepSeek 模型，不需要 API Key，也不会上传 PDF 原件。'
      + '默认后台运行：立即返回 taskId，之后用 pdf_translate_status 查看进度（或在会话标题栏点「PDF 翻译」面板）。'
      + '翻译按页提取文字，扫描件（没有文字层）无法翻译。首次使用建议先用 pages 只翻 1–2 页确认效果。',
    properties: {
      pdf: string('PDF 的绝对路径，例如 /Users/me/paper.pdf'),
      pages: string('要翻译的页码：all、1-5、1,3,5-8。默认 all。'),
      language: string('目标语言，默认「中文」。可填 English、日本語 等。'),
      mode: string('bilingual = 中英对照（默认）；translated = 只要译文。填 bilingual 或 translated。只影响网页版，PDF 始终是译文覆盖。'),
      output: string('输出格式：both（默认，PDF + 网页）、pdf（只保留原版式的 PDF）、web（只要网页对照）。'),
      outputDir: string('输出目录的绝对路径；省略时放在 PDF 同目录下的「<文件名>-翻译」文件夹。'),
      background: boolean('默认 true：立即返回任务 ID。false 表示等到翻译结束再返回结果。'),
    },
    required: ['pdf'],
    async execute(args) {
      const started = await manager.start({
        pdf: args.pdf,
        pages: args.pages,
        language: args.language,
        mode: args.mode,
        output: args.output,
        outputDir: args.outputDir,
      });
      if (args.background === false) {
        const task = await manager.wait(started.task.id);
        return plain({ ok: task.status === 'completed', ...taskSummary(task), stats: task.stats });
      }
      return plain({
        ok: true,
        ...taskSummary(started.task),
        hint: '任务已开始。用 pdf_translate_status（taskId 可选）查看进度；完成后 outputs 里是结果文件路径。',
      });
    },
  }));

  ctx.tools.register(tool({
    name: 'pdf_translate_status',
    description: '查看 PDF 翻译任务的进度与结果。省略 taskId 时返回最近任务列表和当前配置；提供 taskId 时返回该任务的详细状态与输出路径。',
    properties: {
      taskId: string('任务 ID，例如 pt-1a2b3c4d；省略则返回最近任务列表。'),
    },
    async execute(args) {
      const status = await manager.status();
      if (!args.taskId) {
        return plain({
          ok: true,
          model: status.model,
          defaults: status.defaults,
          active: status.active,
          cacheEntries: status.cache.entries,
          tasks: status.tasks.map((task) => taskSummary(task)),
        });
      }
      const task = status.tasks.find((candidate) => candidate.id === args.taskId);
      if (!task) throw new Error(`找不到任务 ${args.taskId}。`);
      return plain({ ok: true, ...taskSummary(task), progress: task.progress, stats: task.stats, warnings: task.warnings });
    },
  }));

  ctx.inject(['webServer', 'connection'], (rctx) => {
    rctx.effect(() => registerRoutes(rctx, manager));
  });

  return { manager, dataDir: manager.dataDir };
}

export { TranslationManager };
