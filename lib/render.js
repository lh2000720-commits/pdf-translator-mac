// Output writers: bilingual Markdown, pure text, and a print-ready standalone HTML reader.
import fs from 'node:fs';
import path from 'node:path';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/** Headings in the source text stay headings in the reader. */
function looksLikeHeading(text) {
  if (!text) return false;
  if (text.length > 90) return false;
  return /^(?:\d+(?:\.\d+)*\.?\s|Abstract\b|Introduction\b|Conclusion\b|References\b|Bibliography\b|Appendix\b)/.test(text);
}

function pageTitle(title) {
  return title || 'PDF 文档';
}

export function renderMarkdown(input) {
  const { title, source, language, modelLabel, createdAt, pages, totalPages, stats, mode } = input;
  const lines = [];
  lines.push(`# ${pageTitle(title)}（${language}）`, '');
  lines.push(`> 原文：\`${source}\``);
  lines.push(`> 模型：${modelLabel} · 页数：${pages.length}/${totalPages} · 生成于 ${createdAt}`);
  if (stats?.chunks) {
    lines.push(`> 段落块：${stats.chunks}（缓存命中 ${stats.cached}${stats.failed ? ` · 失败 ${stats.failed}` : ''}）`);
  }
  lines.push('', '---', '');
  for (const page of pages) {
    lines.push(`## 第 ${page.page} 页`, '');
    for (const block of page.blocks) {
      const original = block.src.trim();
      const target = (block.dst || '').trim();
      if (mode === 'translated') {
        if (target) lines.push(target, '');
      } else if (block.aligned && target) {
        lines.push(original, '', `> ${target.replace(/\n/g, '\n> ')}`, '');
      } else {
        lines.push(original, '', target || '（本段翻译失败，请重试）', '');
      }
    }
    lines.push('---', '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function renderText(input) {
  const { pages, mode } = input;
  const chunks = [];
  for (const page of pages) {
    chunks.push(`【第 ${page.page} 页】`);
    for (const block of page.blocks) {
      if (mode === 'bilingual' && block.aligned) chunks.push(block.src.trim());
      if (block.dst?.trim()) chunks.push(block.dst.trim());
    }
    chunks.push('');
  }
  return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n');
}

export function renderHtml(input) {
  const { title, source, language, modelLabel, createdAt, pages, totalPages, stats, mode } = input;
  const lang = /^(中文|汉语|简体|chinese|zh)/i.test(language) ? 'zh-CN' : 'en';
  const sections = pages.map((page) => {
    const blocks = page.blocks.map((block) => {
      const heading = looksLikeHeading(block.src);
      const sourceHtml = block.aligned || !block.dst
        ? `<p class="src${heading ? ' src-heading' : ''}">${escapeHtml(block.src)}</p>`
        : `<p class="src">${escapeHtml(block.src)}</p>`;
      const target = block.dst?.trim();
      const targetHtml = target
        ? `<p class="dst${heading ? ' dst-heading' : ''}">${escapeHtml(target)}${block.error ? ' <span class="fail">（翻译失败）</span>' : ''}</p>`
        : '<p class="dst fail">（本段翻译失败，可重新运行以续译）</p>';
      return `<div class="pair">${sourceHtml}${targetHtml}</div>`;
    }).join('\n');
    return `<section class="page" id="page-${page.page}">
  <header class="page-head"><span>第 ${page.page} 页</span><span class="muted">${page.blocks.length} 段</span></header>
  ${blocks}
</section>`;
  }).join('\n');

  const failed = stats?.failed ? `<span class="warn">${stats.failed} 段翻译失败</span>` : '';
  const initialMode = mode === 'translated' ? 'only-target' : 'bilingual';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle(title))} · ${escapeHtml(language)}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:#eef0f4;color:#1c2430;font:16px/1.78 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Songti SC",Georgia,serif;-webkit-font-smoothing:antialiased}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 18px;background:rgba(250,251,253,.94);border-bottom:1px solid #d9dee7;backdrop-filter:blur(10px);font-size:13px}
.toolbar strong{font-weight:600;margin-right:4px}
.toolbar .spacer{flex:1}
.toolbar button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #c8d0dc;background:#fff;color:#1c2430;cursor:pointer}
.toolbar button:hover{background:#f1f4f9}
.toolbar button.primary{background:#2f6fe4;border-color:#2f6fe4;color:#fff}
.toolbar button[aria-pressed="true"]{background:#e6eeff;border-color:#9fb9f2}
.muted{color:#69748a;font-size:12px}
.warn{color:#b4690e;font-size:12px}
main{max-width:860px;margin:0 auto;padding:22px 18px 60px}
.doc-head{margin:6px 0 22px}
.doc-head h1{font-size:24px;line-height:1.35;margin:0 0 8px}
.doc-head .meta{font-size:12.5px;color:#69748a;line-height:1.9}
.doc-head .meta code{font-size:12px;background:#e9edf4;padding:1px 6px;border-radius:5px}
.page{background:#fff;border:1px solid #e2e6ee;border-radius:12px;padding:30px 34px 22px;margin:0 0 20px;box-shadow:0 1px 2px rgba(23,32,48,.05)}
.page-head{display:flex;justify-content:space-between;font-size:12px;color:#8a94a6;border-bottom:1px dashed #e3e7ee;padding-bottom:8px;margin-bottom:18px;letter-spacing:.04em}
.pair{margin:0 0 18px}
.pair p{margin:0}
.src{color:#5b6679;font-size:.9em;line-height:1.62;margin-bottom:6px}
.dst{font-size:1.03em;line-height:1.9;color:#141b26}
.src-heading{font-weight:600;color:#3c4759}
.dst-heading{font-weight:600;font-size:1.1em;margin-top:2px}
.fail{color:#b3452a}
body.only-target .src{display:none}
body.only-target .dst{margin-bottom:14px}
@media print{
  body{background:#fff;font-size:10.5pt}
  .toolbar{display:none}
  main{max-width:none;padding:0}
  .doc-head{margin:0 0 14pt}
  .page{border:0;border-radius:0;padding:0;margin:0 0 14pt;box-shadow:none;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  .src{color:#4b5565}
  .pair{page-break-inside:avoid;break-inside:avoid}
}
@page{size:A4;margin:16mm 15mm}
</style>
</head>
<body class="${initialMode}">
<div class="toolbar">
  <strong>PDF 翻译</strong>
  <span class="muted">${escapeHtml(modelLabel)} · ${pages.length}/${totalPages} 页 · ${escapeHtml(createdAt)}</span>
  ${failed}
  <span class="spacer"></span>
  <button type="button" id="toggle-mode" aria-pressed="${initialMode === 'only-target'}">${initialMode === 'only-target' ? '显示原文' : '隐藏原文'}</button>
  <button type="button" class="primary" onclick="window.print()">打印 / 存为 PDF</button>
</div>
<main>
  <div class="doc-head">
    <h1>${escapeHtml(pageTitle(title))}</h1>
    <div class="meta">原文：<code>${escapeHtml(source)}</code><br>译文生成于 ${escapeHtml(createdAt)} · ${escapeHtml(language)} · 段落块 ${stats?.chunks ?? 0} 个（缓存命中 ${stats?.cached ?? 0}${stats?.failed ? ` · 失败 ${stats.failed}` : ''}）</div>
  </div>
  ${sections}
</main>
<script>
(function(){
  var body = document.body;
  var button = document.getElementById('toggle-mode');
  if (!button) return;
  button.addEventListener('click', function(){
    var onlyTarget = body.classList.toggle('only-target');
    button.setAttribute('aria-pressed', String(onlyTarget));
    button.textContent = onlyTarget ? '显示原文' : '隐藏原文';
  });
})();
</script>
</body>
</html>`;
}

/** Write the readable artefacts (Markdown, plain text, print-ready HTML). */
export async function writeDocuments(folder, baseName, input) {
  await fs.promises.mkdir(folder, { recursive: true });
  const safeBase = String(baseName).replace(/[\\/:*?"<>|]/g, '_');
  const markdown = path.join(folder, `${safeBase}.zh.md`);
  const text = path.join(folder, `${safeBase}.zh.txt`);
  const html = path.join(folder, `${safeBase}.zh.html`);
  await Promise.all([
    fs.promises.writeFile(markdown, renderMarkdown(input), 'utf8'),
    fs.promises.writeFile(text, renderText(input), 'utf8'),
    fs.promises.writeFile(html, renderHtml(input), 'utf8'),
  ]);
  return { markdown, text, html };
}

export function reportPath(folder) {
  return path.join(folder, 'translation-report.json');
}

export async function writeReport(folder, report) {
  await fs.promises.mkdir(folder, { recursive: true });
  const target = reportPath(folder);
  await fs.promises.writeFile(target, JSON.stringify(report, null, 2), 'utf8');
  return target;
}

export { escapeHtml };
