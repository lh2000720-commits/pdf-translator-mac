# PDF 翻译（macOS）

DeepSeek Harness 插件：把本地 PDF 逐页翻译成中文（或任意指定语言），直接使用当前登录的 **DeepSeek 模型**，不需要自备 API Key，也不会上传 PDF 原件。

- **直接输出 PDF，且保留原版式**：页面尺寸、图片、图表、分栏、页眉页脚、页码都不动，译文按原文的段落位置覆盖上去（`.zh.pdf`）。
- 同时生成中英对照的可打印 HTML、Markdown 和纯文本，方便校对与摘录。
- 面板：聊天标题栏 →「PDF 翻译」，选 PDF、页码、输出方式，一键开始，实时进度、可取消。
- 工具：`pdf_translate` / `pdf_translate_status`，可以在对话里直接让 AI 翻译。
- 纯 macOS：文件选择用系统原生对话框（`osascript`），没有 Windows PowerShell、Python venv、LaTeX 依赖。
- 断点续译：每一段的译文都会进本地缓存，取消或失败后重新运行只翻没翻过的段落。

## 环境

- DeepSeek Harness 桌面版（Web GUI），macOS。
- 需要已登录 DeepSeek 账号（或已在 Harness 里配置好可用的模型）；插件使用「当前默认模型」。
- 依赖 `pdfjs-dist`（安装时已随插件一起装好，位于本目录 `node_modules/`）。

## 安装与启用

先在插件目录装依赖（`pdfjs-dist`、`pdf-lib`、`@pdf-lib/fontkit`）：

```bash
cd pdf-translator-mac
pnpm install        # 没有 pnpm 时用 npm install
```

再把插件目录装进 profile：

```bash
dsh plugin --profile desktop add /绝对路径/pdf-translator-mac
```

或桌面端「插件 → 添加插件」选择本目录。安装后：

1. 重新打开 Harness 页面（⌘R 刷新）让浏览器加载插件的 Client 模块。
2. 聊天标题栏出现「PDF 翻译」按钮即成功。

## 使用

### 面板

1. 点标题栏「PDF 翻译」。
2. 点「选择…」用系统对话框挑 PDF，或点「浏览」在内置文件列表里点选，也可以直接粘贴绝对路径。
3. 页码填 `全部`、`1-5` 或 `1,3,5-8`；选输出格式（「PDF 原版式」/「网页对照」/「两个都要」，默认两个都要）和目标语言（默认中文）。「网页对照方式」只影响网页版，PDF 始终是译文覆盖。
4. 输出目录留空时，结果放在 PDF 同目录的 `<文件名>-翻译/`。
5. 点「开始翻译」。进度条显示解析页数与翻译段数，随时可以「取消任务」；取消后已翻译的段落留在缓存里。
6. 完成后点「打开译文 PDF」、「网页对照」、「Markdown」或「文件夹」。

### 在对话里用

```
用 pdf_translate 把 /Users/you/paper.pdf 的第 1-3 页翻译成中文
```

工具参数：

| 参数 | 说明 |
| --- | --- |
| `pdf` | PDF 绝对路径（必填） |
| `pages` | `all`、`1-5`、`1,3,5-8`，默认 all |
| `language` | 目标语言，默认「中文」 |
| `mode` | `bilingual`（默认）或 `translated`，只影响网页版 |
| `output` | `both`（默认）、`pdf`（只出原版式 PDF）、`web`（只出网页对照） |
| `outputDir` | 输出目录，省略时用同目录 `<文件名>-翻译/` |
| `background` | 默认 `true`（立即返回任务 ID）；`false` 等到结束再返回结果 |

`pdf_translate_status` 查看进度：不带 `taskId` 返回最近任务，带 `taskId` 返回该任务详情。

## 输出文件

`<输出目录>/<文件名>-翻译/` 下：

- `<文件名>.zh.pdf` — **保留原版式的中文 PDF**：在原 PDF 的每一页上，把原文段落区域盖成白底、在原来的位置写入译文；字号会自动压缩以塞进原段落的高度，一行的标题会优先保持一行。图片、图表、分栏、页眉页脚和页码都不动，扫描页的文字位置由 OCR 文字层决定。
- `<文件名>.zh.html` — 中英对照阅读页，带打印样式（A4）；「中英对照 / 仅译文」开关对 HTML/Markdown 有效，PDF 始终是译文覆盖原文。
- `<文件名>.zh.md` — 对照 Markdown（原文段落 + 引用块译文）。
- `<文件名>.zh.txt` — 纯译文。
- `translation-report.json` — 页数、模型、耗时、token 用量、失败段落，以及 PDF 覆盖的段落数与被跳过的页。

同一份 PDF 再翻一次会复用缓存，只补翻变化的段落。只翻译选中页时，PDF 里未选中的页保持原文。

## 已知限制

- 只处理**带文字层**的 PDF。扫描件（图片型 PDF）没有文字，会直接提示；请先用 OCR 工具处理。
- 扫描件自带的 OCR 文字层常有断词、错字（如 `twelvetone`、`Webem`、句号错位），译文会继承这些错误；插件会尽量恢复被换行拆开的单词。
- 原版式 PDF 依赖原 PDF 的文字坐标：旋转页（/Rotate 非 0）或裁切框与页面不一致的页会被跳过（网页版仍完整），报告里会列出跳过的页码。
- 中文字体：macOS 自带的 PingFang、宋体是 `.ttc` 字体集合，无法直接嵌入 PDF。插件优先使用 `/Library/Fonts/Arial Unicode.ttf`；找不到时可以把任意中文 TTF/OTF（例如 Noto Sans SC）放到 `~/.dsh/pdf-translator-mac/fonts/`，或用配置项 `fontPath` 指定。找不到字体时 PDF 会生成失败并保留网页版译文。
- 页码选择上限默认 120 页（`maxPages` 可调），避免一次意外产生超大账单。
- 公式会原样保留，但复杂数学排版不做重建；需要排版级重建请用专门的 LaTeX 翻译工具。

## 隐私

PDF 的**文本内容**会按段落发送给当前配置的模型端点（默认 DeepSeek 官方服务）；PDF 文件本身、路径不会上传。缓存只存在本机 `~/.dsh/pdf-translator-mac/`。

## 配置（可选）

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里覆盖本插件的行即可，不需要改插件代码：

```yaml
- id: pdf-translator-mac
  name: '@local/pdf-translator-mac'
  config:
    concurrency: 4          # 并发段落数，默认 3
    maxChunkChars: 1800     # 单次请求的最大字符数
    maxPages: 120           # 单次任务页数上限
    output: both            # 默认输出格式：both / pdf / web
    provider: deepseek-official   # 省略时用当前默认模型
    model: deepseek-flash
    reasoningEffort: low    # 省略时自动选该模型最低的推理强度
    cacheEntries: 4000      # 本地译文缓存条数上限
    dataDir: ~/.dsh/pdf-translator-mac  # 状态与缓存目录
    fontPath: /Library/Fonts/Arial Unicode.ttf  # 生成 PDF 用的中文 TTF/OTF（可省略）
```

## 目录结构

```
index.js            Host 入口：注册工具与面板 HTTP 路由
client.js           浏览器半：标题栏按钮 + 弹层面板（React，无构建步骤）
lib/pdf-text.js     PDF 文字提取、分栏/断词/段落还原（pdfjs-dist）
lib/translate.js    分块、提示词、并发、重试、截断续翻、译文缓存
lib/llm.js          通过 Harness 的 llm 服务调用当前 DeepSeek 模型
lib/render.js       Markdown / 纯文本 / 可打印 HTML 渲染
lib/pdf-overlay.js  原版式 PDF：覆盖原文段落、按原坐标写中文、字号自适应
lib/manager.js      任务状态、进度、持久化、原生文件对话框
lib/routes.js       面板专用 POST API（复用宿主 connection 鉴权）
locale/{zh,en}.json 插件市场/插件列表显示的标题与描述
```

## 卸载

插件 → 已安装 → 本插件 → 停用 / 移除；或删除 `~/.dsh/plugins/pdf-translator-mac` 并从 profile 的 `package.json` 去掉依赖与 bundle 行。用户数据在 `~/.dsh/pdf-translator-mac/`，可手动删除。

## 许可

MIT（见 [LICENSE](LICENSE)）。图标为本项目原创；PDF 解析使用 [pdfjs-dist](https://github.com/mozilla/pdf.js)（Apache-2.0），PDF 写入使用 [pdf-lib](https://github.com/Hopding/pdf-lib)（MIT）。
