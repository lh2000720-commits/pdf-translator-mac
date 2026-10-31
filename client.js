// Browser half: a header button plus a modal panel that drives the Host manager over its private API.
window.__ModuleLoader__.load({
  id: '@local/pdf-translator-mac',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const NS = 'pdf-translator-mac';
    const API = '/pdf-translator-mac/api/';

    const DICT = {
      zh: {
        'trigger': 'PDF 翻译',
        'trigger.title': '打开 PDF 翻译面板（使用当前 DeepSeek 模型）',
        'panel.title': 'PDF 翻译',
        'panel.subtitle': '用当前登录的 DeepSeek 模型逐页翻译，不需要 API Key',
        'close': '关闭',
        'file': 'PDF 文件',
        'file.placeholder': '/Users/you/paper.pdf',
        'file.pick': '选择…',
        'file.browse': '浏览',
        'file.hint': '支持带文字层的 PDF；扫描件需要先做 OCR。',
        'inspect': '共 {pages} 页 · {size} · {title}',
        'options': '选项',
        'pages': '页码',
        'pages.placeholder': '全部，或 1-5、1,3,5-8',
        'language': '目标语言',
        'output': '输出格式',
        'output.both': '两个都要',
        'output.pdf': 'PDF 原版式',
        'output.web': '网页对照',
        'mode': '网页对照方式',
        'mode.bilingual': '中英对照',
        'mode.translated': '仅译文',
        'output': '输出目录',
        'output.placeholder': '默认：PDF 同目录下的「文件名-翻译」',
        'output.pick': '选择文件夹',
        'start': '开始翻译',
        'starting': '正在提交…',
        'cancel': '取消任务',
        'cancelling': '正在取消…',
        'running': '翻译中',
        'progress.extract': '解析 PDF {done}/{total} 页',
        'progress.translating': '翻译第 {page} 页 · {done}/{total} 段',
        'progress.writing': '生成文件…',
        'empty': '选择一份 PDF，确认页码后开始。翻译在后台进行，可以收起面板继续用 Harness。',
        'tasks': '最近任务',
        'open.pdf': '打开译文 PDF',
        'open.html': '网页对照',
        'open.markdown': 'Markdown',
        'open.folder': '文件夹',
        'status.completed': '完成',
        'status.failed': '失败',
        'status.cancelled': '已取消',
        'status.interrupted': '已中断',
        'status.running': '进行中',
        'status.queued': '排队中',
        'model': '模型：{model}',
        'model.missing': '未找到可用模型：{error}',
        'cache': '译文缓存 {count} 段，重复翻译会直接复用。',
        'browse.up': '上一级',
        'browse.home': '个人目录',
        'browse.empty': '这个目录里没有子文件夹或 PDF。',
        'browse.close': '返回',
        'footer': '输出目录里有：<文件名>.zh.pdf（保留原版式）、.zh.html（网页对照）、.zh.md、.zh.txt。',
        'note.started': '翻译已开始，正在后台运行。',
        'note.opened': '已打开：{path}',
        'note.picked': '已填入系统选择的结果。',
        'error.prefix': '出错了：',
      },
      en: {
        'trigger': 'PDF Translate',
        'trigger.title': 'Open the PDF translation panel (uses the current DeepSeek model)',
        'panel.title': 'PDF translation',
        'panel.subtitle': 'Page-by-page translation with the signed-in DeepSeek model — no API key needed',
        'close': 'Close',
        'file': 'PDF file',
        'file.placeholder': '/Users/you/paper.pdf',
        'file.pick': 'Choose…',
        'file.browse': 'Browse',
        'file.hint': 'PDFs with a text layer work best; scanned pages need OCR first.',
        'inspect': '{pages} pages · {size} · {title}',
        'options': 'Options',
        'pages': 'Pages',
        'pages.placeholder': 'all, or 1-5, 1,3,5-8',
        'language': 'Target language',
        'output': 'Output',
        'output.both': 'Both',
        'output.pdf': 'Layout PDF',
        'output.web': 'Web page',
        'mode': 'Web page style',
        'mode.bilingual': 'Bilingual',
        'mode.translated': 'Translation only',
        'output': 'Output folder',
        'output.placeholder': 'Default: "<name>-翻译" next to the PDF',
        'output.pick': 'Choose folder',
        'start': 'Start translating',
        'starting': 'Submitting…',
        'cancel': 'Cancel task',
        'cancelling': 'Cancelling…',
        'running': 'Translating',
        'progress.extract': 'Reading PDF {done}/{total}',
        'progress.translating': 'Page {page} · {done}/{total} chunks',
        'progress.writing': 'Writing files…',
        'empty': 'Pick a PDF, confirm the pages, and start. Translation runs in the background — you can keep using Harness.',
        'tasks': 'Recent tasks',
        'open.pdf': 'Open translated PDF',
        'open.html': 'Bilingual web page',
        'open.markdown': 'Markdown',
        'open.folder': 'Folder',
        'status.completed': 'Done',
        'status.failed': 'Failed',
        'status.cancelled': 'Cancelled',
        'status.interrupted': 'Interrupted',
        'status.running': 'Running',
        'status.queued': 'Queued',
        'model': 'Model: {model}',
        'model.missing': 'No model available: {error}',
        'cache': '{count} cached chunks; re-runs reuse them.',
        'browse.up': 'Up',
        'browse.home': 'Home',
        'browse.empty': 'No subfolders or PDFs here.',
        'browse.close': 'Back',
        'footer': 'Results land in the output folder: <name>.zh.html (print-ready), .zh.md, .zh.txt.',
        'note.started': 'Translation started in the background.',
        'note.opened': 'Opened: {path}',
        'note.picked': 'System dialog result filled in.',
        'error.prefix': 'Error: ',
      },
    };

    const STYLE_ID = 'pdf-translator-mac-style';
    const CSS = `
.ptm-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:1;cursor:pointer;white-space:nowrap}
.ptm-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ptm-trigger svg{display:block;flex:none}
.ptm-backdrop{position:fixed;inset:0;z-index:70;pointer-events:auto;display:flex;justify-content:center;align-items:flex-start;padding:min(9vh,88px) 16px 32px;background:rgba(9,14,24,.38);overflow:auto}
.ptm-card{width:min(600px,100%);max-height:calc(100dvh - min(9vh,88px) - 32px);overflow:auto;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 24px 64px rgba(8,15,30,.32);padding:18px 20px 16px;font-size:13px;line-height:1.6}
.ptm-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.ptm-head h2{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.ptm-sub{margin:2px 0 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.ptm-x{margin-left:auto;flex:none;width:26px;height:26px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer}
.ptm-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ptm-label{display:block;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:0 0 5px;letter-spacing:.02em}
.ptm-row{display:flex;gap:7px;align-items:center}
.ptm-row+.ptm-row{margin-top:7px}
.ptm-input{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px}
.ptm-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ptm-input::placeholder{color:var(--dsw-alias-state-idle-primary)}
.ptm-btn{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.ptm-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.ptm-btn:disabled{opacity:.5;cursor:default}
.ptm-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}
.ptm-btn.primary:hover{filter:brightness(1.06)}
.ptm-btn.ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:0 6px}
.ptm-btn.ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ptm-section{margin-top:14px}
.ptm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ptm-seg{display:flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.ptm-seg button{flex:1;height:30px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.ptm-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.ptm-hint{margin:6px 0 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.ptm-error{margin:10px 0 0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.ptm-note{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary)}
.ptm-actions{display:flex;align-items:center;gap:8px;margin-top:16px}
.ptm-actions .spacer{flex:1}
.ptm-progress{height:6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:10px}
.ptm-progress i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:4px;transition:width .4s ease}
.ptm-progress-text{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.ptm-task{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 0 2px;margin-top:10px}
.ptm-task:first-child{border-top:0}
.ptm-task-head{display:flex;align-items:center;gap:8px}
.ptm-task-name{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.ptm-chip{flex:none;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.ptm-chip.run{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.ptm-chip.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.ptm-chip.bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.ptm-task-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.ptm-task-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.ptm-task-actions .ptm-btn{height:26px;padding:0 9px;font-size:11.5px}
.ptm-warn{margin-top:6px;font-size:11.5px;color:var(--dsw-alias-state-warn-primary)}
.ptm-empty{margin:14px 0 0;padding:14px;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}
.ptm-foot{margin:14px 0 0;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-state-idle-primary)}
.ptm-browser{position:fixed;inset:0;z-index:71;display:flex;justify-content:center;align-items:center;background:rgba(9,14,24,.34);padding:24px}
.ptm-browser-card{width:min(520px,100%);max-height:70vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 20px 52px rgba(8,15,30,.3);overflow:hidden}
.ptm-browser-head{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.ptm-browser-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;color:var(--dsw-alias-label-secondary)}
.ptm-browser-list{overflow:auto;padding:6px}
.ptm-browser-item{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;padding:8px 9px;border-radius:7px;cursor:pointer}
.ptm-browser-item:hover{background:var(--dsw-alias-bg-layer-2)}
.ptm-browser-item .size{margin-left:auto;font-size:11px;color:var(--dsw-alias-state-idle-primary)}
.ptm-browser-item .glyph{width:16px;flex:none;text-align:center;color:var(--dsw-alias-label-secondary)}
.ptm-center{text-align:center}
`;

    function ensureStyle() {
      if (typeof document === 'undefined') return () => {};
      const existing = document.getElementById(STYLE_ID);
      if (existing) return () => {};
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.append(style);
      return () => style.remove();
    }

    function formatSize(bytes) {
      if (!bytes) return '0 KB';
      if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    }

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get() {
          return state;
        },
        set(patch) {
          state = { ...state, ...patch };
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    function useSnapshot(store) {
      const [snapshot, setSnapshot] = useState(store.get);
      useEffect(() => {
        setSnapshot(store.get());
        return store.subscribe(() => setSnapshot(store.get()));
      }, []);
      return snapshot;
    }

    async function api(action, body) {
      const response = await fetch(API + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error((payload && payload.error) || `请求失败（HTTP ${response.status}）`);
      }
      return payload;
    }

    function Icon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none' },
        h('path', { d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h8L20 10.5V19a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M13 4v6h6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M8 15.5h5.5M8 18h3.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M17 16.5l1.8 1.8 3-3.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', transform: 'translate(-2.2 0.2) scale(0.82)' }));
    }

    function Translate(t) {
      return (key, values) => {
        const template = t(key);
        if (!values) return template;
        return String(template).replace(/\{(\w+)\}/g, (match, name) => (values[name] === undefined ? match : String(values[name])));
      };
    }

    function PanelHost(props) {
      const snapshot = useSnapshot(props.store);
      if (!snapshot.open) return null;
      return h(Panel, { ...props, onClose: () => props.store.set({ open: false }) });
    }

    function Panel(props) {
      const { tr, onClose } = props;
      const [status, setStatus] = useState(null);
      const [pdf, setPdf] = useState('');
      const [pages, setPages] = useState('all');
      const [mode, setMode] = useState('bilingual');
      const [output, setOutput] = useState('both');
      const [outputDir, setOutputDir] = useState('');
      const [language, setLanguage] = useState('中文');
      const [info, setInfo] = useState(null);
      const [error, setError] = useState('');
      const [note, setNote] = useState('');
      const [busy, setBusy] = useState('');
      const [browser, setBrowser] = useState(null);
      const cardRef = useRef(null);
      const pdfRef = useRef(null);
      const initialized = useRef(false);

      const refresh = useCallback(async () => {
        try {
          return await api('status');
        } catch (failure) {
          setError(failure.message);
          return null;
        }
      }, []);

      useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          const next = await refresh();
          if (!alive) return;
          if (next) setStatus(next);
          timer = setTimeout(tick, 1700);
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [refresh]);

      useEffect(() => {
        if (!status || initialized.current) return;
        initialized.current = true;
        setMode(status.defaults?.mode === 'translated' ? 'translated' : 'bilingual');
        setOutput(['both', 'pdf', 'web'].includes(status.defaults?.output) ? status.defaults.output : 'both');
        setOutputDir(status.defaults?.outputDir || '');
        setLanguage(status.defaults?.language || '中文');
      }, [status]);

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            if (browser) setBrowser(null);
            else onClose();
          }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [browser, onClose]);

      useEffect(() => {
        const timer = setTimeout(() => pdfRef.current?.focus(), 30);
        return () => clearTimeout(timer);
      }, []);

      const inspect = async (value, signal) => {
        if (!value.trim()) {
          setInfo(null);
          return null;
        }
        try {
          const result = await api('inspect', { path: value.trim() });
          setInfo(result);
          return result;
        } catch (failure) {
          setInfo(null);
          if (!signal?.silent) setError(failure.message);
          return null;
        }
      };

      const applyPickedPath = (path) => {
        setPdf(path);
        setError('');
        setNote(tr('note.picked'));
        void inspect(path);
      };

      const pick = async (kind) => {
        setBusy(kind);
        setError('');
        setNote('');
        try {
          const result = await api('pick', { kind });
          if (result.cancelled) return;
          if (kind === 'pdf') applyPickedPath(result.path);
          else {
            setOutputDir(result.path);
            setNote(tr('note.picked'));
          }
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy('');
        }
      };

      const browse = async (path) => {
        setBusy('browse');
        setError('');
        try {
          const listing = await api('list', { path });
          setBrowser(listing);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy('');
        }
      };

      const start = async () => {
        setError('');
        setNote('');
        if (!pdf.trim()) {
          setError('请先选择 PDF 文件。');
          return;
        }
        setBusy('start');
        try {
          await api('start', {
            pdf: pdf.trim(),
            pages: pages.trim() || 'all',
            mode,
            output,
            language: language.trim() || '中文',
            ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {}),
          });
          setNote(tr('note.started'));
          void api('defaults', { mode, output, language: language.trim() || '中文', ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {}) }).catch(() => {});
          const next = await refresh();
          if (next) setStatus(next);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy('');
        }
      };

      const cancel = async (taskId) => {
        setError('');
        setBusy('cancel');
        try {
          await api('cancel', { taskId });
          const next = await refresh();
          if (next) setStatus(next);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy('');
        }
      };

      const openResult = async (taskId, kind) => {
        setError('');
        try {
          const result = await api('open', { taskId, kind });
          setNote(tr('note.opened', { path: result.opened }));
        } catch (failure) {
          setError(failure.message);
        }
      };

      const activeTask = status?.tasks?.find((task) => ['queued', 'extracting', 'translating', 'writing', 'cancelling'].includes(task.status));
      const tasks = status?.tasks || [];
      const model = status?.model;
      const progress = activeTask?.progress;
      const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
      const progressText = progress
        ? progress.phase === 'translating'
          ? tr('progress.translating', { done: progress.done, total: progress.total, page: progress.page || 1 })
          : progress.phase === 'writing'
            ? tr('progress.writing')
            : tr('progress.extract', { done: progress.done, total: progress.total })
        : '';

      const statusChip = (task) => {
        if (task.status === 'completed') return h('span', { className: 'ptm-chip ok' }, tr('status.completed'));
        if (task.status === 'failed') return h('span', { className: 'ptm-chip bad' }, tr('status.failed'));
        if (task.status === 'cancelled') return h('span', { className: 'ptm-chip' }, tr('status.cancelled'));
        if (task.status === 'interrupted') return h('span', { className: 'ptm-chip bad' }, tr('status.interrupted'));
        if (task.status === 'cancelling') return h('span', { className: 'ptm-chip run' }, tr('cancelling'));
        return h('span', { className: 'ptm-chip run' }, tr('status.running'));
      };

      const taskMeta = (task) => {
        const bits = [];
        if (task.selectedPages?.length) bits.push(`${task.selectedPages.length}/${task.totalPages} 页`);
        if (task.mode === 'translated') bits.push(tr('mode.translated'));
        else bits.push(tr('mode.bilingual'));
        if (task.progress && task.progress.total > 0 && task.status !== 'completed') bits.push(`${task.progress.done}/${task.progress.total}`);
        return bits.join(' · ');
      };

      const browserView = browser
        ? h('div', { className: 'ptm-browser', onMouseDown: (event) => { if (event.target === event.currentTarget) setBrowser(null); } },
          h('div', { className: 'ptm-browser-card', role: 'dialog', 'aria-label': tr('file.browse') },
            h('div', { className: 'ptm-browser-head' },
              h('button', { type: 'button', className: 'ptm-btn', onClick: () => { void browse(browser.parent); }, disabled: !browser.parent }, tr('browse.up')),
              h('button', { type: 'button', className: 'ptm-btn', onClick: () => { void browse(browser.home); } }, tr('browse.home')),
              h('span', { className: 'ptm-browser-path', title: browser.path }, browser.path),
              h('button', { type: 'button', className: 'ptm-btn ghost', onClick: () => setBrowser(null) }, tr('browse.close'))),
            h('div', { className: 'ptm-browser-list' },
              browser.entries.length === 0
                ? h('p', { className: 'ptm-hint ptm-center' }, tr('browse.empty'))
                : browser.entries.map((entry) => h('button', {
                  type: 'button',
                  key: entry.path,
                  className: 'ptm-browser-item',
                  onClick: () => {
                    if (entry.type === 'dir') void browse(entry.path);
                    else {
                      applyPickedPath(entry.path);
                      setBrowser(null);
                    }
                  },
                },
                h('span', { className: 'glyph' }, entry.type === 'dir' ? '▸' : 'PDF'),
                h('span', { className: 'ptm-task-name' }, entry.name),
                entry.type === 'pdf' ? h('span', { className: 'size' }, formatSize(entry.size)) : null)))))
        : null;

      return h('div', { className: 'ptm-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h('div', { className: 'ptm-card', ref: cardRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('panel.title'), onMouseDown: (event) => event.stopPropagation() },
          h('div', { className: 'ptm-head' },
            h('div', null,
              h('h2', null, tr('panel.title')),
              h('p', { className: 'ptm-sub' }, tr('panel.subtitle'))),
            h('button', { type: 'button', className: 'ptm-x', 'aria-label': tr('close'), onClick: onClose }, '×')),

          model && !model.error
            ? h('p', { className: 'ptm-hint' }, tr('model', { model: model.label || model.model }))
            : h('p', { className: 'ptm-hint' }, tr('model.missing', { error: model?.error || 'unknown' })),

          h('div', { className: 'ptm-section' },
            h('label', { className: 'ptm-label', htmlFor: 'ptm-pdf' }, tr('file')),
            h('div', { className: 'ptm-row' },
              h('input', {
                id: 'ptm-pdf',
                ref: pdfRef,
                className: 'ptm-input',
                value: pdf,
                placeholder: tr('file.placeholder'),
                spellCheck: false,
                onChange: (event) => {
                  setPdf(event.target.value);
                  setInfo(null);
                  setError('');
                },
                onBlur: () => { if (pdf.trim() && !info) void inspect(pdf); },
              }),
              h('button', { type: 'button', className: 'ptm-btn', disabled: busy === 'pick', onClick: () => void pick('pdf') }, tr('file.pick')),
              h('button', { type: 'button', className: 'ptm-btn', disabled: busy === 'browse', onClick: () => void browse(pdf.trim() ? pdf.replace(/\/[^/]*$/, '') : status?.defaults?.lastDir) }, tr('file.browse'))),
            info
              ? h('p', { className: 'ptm-hint' }, tr('inspect', { pages: info.pages, size: formatSize(info.bytes), title: info.title || '' }))
              : h('p', { className: 'ptm-hint' }, tr('file.hint'))),

          h('div', { className: 'ptm-section ptm-grid' },
            h('div', null,
              h('label', { className: 'ptm-label', htmlFor: 'ptm-pages' }, tr('pages')),
              h('input', {
                id: 'ptm-pages',
                className: 'ptm-input',
                style: { width: '100%' },
                value: pages,
                placeholder: tr('pages.placeholder'),
                spellCheck: false,
                onChange: (event) => setPages(event.target.value),
              })),
            h('div', null,
              h('label', { className: 'ptm-label', htmlFor: 'ptm-lang' }, tr('language')),
              h('input', {
                id: 'ptm-lang',
                className: 'ptm-input',
                style: { width: '100%' },
                value: language,
                placeholder: '中文',
                spellCheck: false,
                onChange: (event) => setLanguage(event.target.value),
              }))),

          h('div', { className: 'ptm-section ptm-grid' },
            h('div', null,
              h('span', { className: 'ptm-label' }, tr('output')),
              h('div', { className: 'ptm-seg' },
                h('button', { type: 'button', 'aria-pressed': output === 'pdf', onClick: () => setOutput('pdf') }, tr('output.pdf')),
                h('button', { type: 'button', 'aria-pressed': output === 'web', onClick: () => setOutput('web') }, tr('output.web')),
                h('button', { type: 'button', 'aria-pressed': output === 'both', onClick: () => setOutput('both') }, tr('output.both')))),
            h('div', null,
              h('span', { className: 'ptm-label' }, tr('mode')),
              h('div', { className: 'ptm-seg' },
                h('button', { type: 'button', 'aria-pressed': mode === 'bilingual', onClick: () => setMode('bilingual') }, tr('mode.bilingual')),
                h('button', { type: 'button', 'aria-pressed': mode === 'translated', onClick: () => setMode('translated') }, tr('mode.translated'))))),

          h('div', { className: 'ptm-section' },
            h('label', { className: 'ptm-label', htmlFor: 'ptm-out' }, tr('output')),
            h('div', { className: 'ptm-row' },
              h('input', {
                id: 'ptm-out',
                className: 'ptm-input',
                value: outputDir,
                placeholder: tr('output.placeholder'),
                spellCheck: false,
                onChange: (event) => setOutputDir(event.target.value),
              }),
              h('button', { type: 'button', className: 'ptm-btn', disabled: busy === 'directory', onClick: () => void pick('directory') }, tr('output.pick')))),

          error ? h('p', { className: 'ptm-error', role: 'alert' }, error) : null,
          note ? h('p', { className: 'ptm-note', role: 'status' }, note) : null,

          h('div', { className: 'ptm-actions' },
            h('button', { type: 'button', className: 'ptm-btn primary', disabled: busy === 'start' || !!activeTask, onClick: () => void start() }, busy === 'start' ? tr('starting') : tr('start')),
            activeTask
              ? h('button', { type: 'button', className: 'ptm-btn', disabled: busy === 'cancel', onClick: () => void cancel(activeTask.id) }, busy === 'cancel' ? tr('cancelling') : tr('cancel'))
              : null,
            h('span', { className: 'spacer' }),
            h('span', { className: 'ptm-hint' }, tr('cache', { count: status?.cache?.entries ?? 0 }))),

          activeTask
            ? h('div', { className: 'ptm-section' },
              h('div', { className: 'ptm-progress' }, h('i', { style: { width: `${percent}%` } })),
              h('div', { className: 'ptm-progress-text' },
                h('span', null, `${activeTask.name} · ${progressText}`),
                h('span', null, `${percent}%`)))
            : h('p', { className: 'ptm-empty' }, tr('empty')),

          tasks.length
            ? h('div', { className: 'ptm-section' },
              h('p', { className: 'ptm-label' }, tr('tasks')),
              tasks.map((task) => h('div', { className: 'ptm-task', key: task.id },
                h('div', { className: 'ptm-task-head' },
                  h('span', { className: 'ptm-task-name', title: task.pdf }, task.name),
                  statusChip(task)),
                h('div', { className: 'ptm-task-meta' }, taskMeta(task)),
                task.error ? h('p', { className: 'ptm-error' }, task.error) : null,
                (task.warnings || []).map((warning) => h('p', { className: 'ptm-warn', key: warning }, warning)),
                task.outputs
                  ? h('div', { className: 'ptm-task-actions' },
                    task.outputs.pdf
                      ? h('button', { type: 'button', className: 'ptm-btn', onClick: () => void openResult(task.id, 'pdf') }, tr('open.pdf'))
                      : null,
                    h('button', { type: 'button', className: 'ptm-btn', onClick: () => void openResult(task.id, 'html') }, tr('open.html')),
                    h('button', { type: 'button', className: 'ptm-btn', onClick: () => void openResult(task.id, 'markdown') }, tr('open.markdown')),
                    h('button', { type: 'button', className: 'ptm-btn', onClick: () => void openResult(task.id, 'folder') }, tr('open.folder')))
                  : ['failed', 'cancelled'].includes(task.status)
                    ? h('div', { className: 'ptm-task-actions' },
                      h('button', { type: 'button', className: 'ptm-btn', onClick: () => { setPdf(task.pdf); setPages(task.selectedPages?.length === task.totalPages ? 'all' : (task.selectedPages || []).join(',')); setMode(task.mode); setError(''); setNote(''); void inspect(task.pdf); } }, '填入并重试'))
                    : null)))
            : null,

          h('p', { className: 'ptm-foot' }, tr('footer'))),
        browserView);
    }

    const store = createStore({ open: false });

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(ensureStyle);
        const registerDict = (locale, dict) => ctx.effect(() => {
          try {
            return ctx.locale.register(NS, locale, dict);
          } catch {
            return () => {};
          }
        });
        registerDict('zh', DICT.zh);
        registerDict('en', DICT.en);
        const translate = ctx.locale.bind(NS);
        const tr = Translate((key) => {
          const value = translate(key);
          if (value !== key) return value;
          return DICT.zh[key] ?? key;
        });

        function Trigger() {
          const snapshot = useSnapshot(store);
          return h('button', {
            type: 'button',
            className: 'ptm-trigger',
            title: tr('trigger.title'),
            'aria-haspopup': 'dialog',
            'aria-expanded': snapshot.open ? 'true' : 'false',
            onClick: () => store.set({ open: true }),
          }, h(Icon), tr('trigger'));
        }

        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: NS,
          order: 30,
        }, Trigger));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: NS,
          order: 40,
        }, (props) => h(PanelHost, { store, tr })));
      },
    };
  },
});
