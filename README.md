# WeChat Post Publisher (CLI)

这是一个基于 Node.js (TypeScript) 开发的高保真、自动化命令行工具，专门用于将 Jekyll 或其他标准 Markdown 博客文章一键同步至微信公众号的**草稿箱**。

它深度解决了微信公众号后台排版中**“本地图片无法直接使用”**、**“外部 CSS 样式被过滤”**以及**“Mermaid 图表不兼容”**等博主最痛苦的问题。

## 🌟 核心特性

### 1. 🚀 自动化发布流
- **一键同步**：解析本地 Markdown 及其 Front-matter，自动创建或更新微信草稿。
- **批量同步 (`latest`)**：支持按日期倒序自动同步最近的 N 篇文章，极大提升效率。
- **智能防重复**：基于文章标题智能检索草稿箱，支持交互式确认或 `--force` 强制覆盖更新。

### 2. 🖼️ 强大媒体处理管道
- **自动化图片同步**：自动提取正文图片并上传至微信 CDN，并在原文中完成路径替换。
- **封面图管理**：自动上传 Front-matter 指定的封面图作为微信永久素材。
- **🧜 Mermaid 引擎**：自动识别 Mermaid 代码块并转换为静态图片，确信流程图、时序图在手机端完美显示。
- **智能缓存系统**：按公众号与 API 地址隔离上传记录，使用 `.temp/resource-cache-v2` 独立条目缓存，避免不同账号误用素材。

### 3. 🎨 高保真排版兼容
- **结构保真渲染**：采用 GitHub 风格（GFM）样式表，确保本地预览与手机端效果高度一致。
- **CSS 内联化 (Inlining)**：使用 `Juice` 将样式直接注入标签，绕过微信对外部样式的严格限制。
- **列表兼容补丁**：深度剔除 `<ul>`/`<ol>` 与 `<li>` 标签间的换行符（`\n`），彻底修复微信编辑器自动插入 `<section><br></section>` 导致的多余黑点（Phantom Bullets）问题；同时调整 `list-style-position` 确保移动端缩进呈现完美对齐。
- **绝对链接转换**：自动将站内相对链接转换为绝对链接（基于 `siteUrl` 配置）。
- **健壮性净化**：自动移除 `id`、`class` 属性，并在同步前报告超限字段，避免静默截断内容。

### 4. 🛡️ 稳定同步边界
- **微信门禁预检**：同步前检查标题、作者、摘要、正文字符数/字节数、封面和 HTML 安全标签。
- **外链图片归一化**：正文中的 HTTP/HTTPS 图片会先下载，再上传到微信正文图床；资源失败时不会创建缺图草稿。
- **上传限制预检**：正文图床仅接收小于 1 MiB 的 JPEG/PNG；封面和图片消息使用永久素材接口，保留不超过 2 MiB 的 JPEG/PNG/GIF。格式、真实图片内容和大小均在写入前检查；导出格式支持范围独立于上传限制。
- **公式图片化**：行内 `$...$` 和块级 `$$...$$` 公式转换为 PNG 后上传微信。
- **Mermaid 可降级**：Kroki 暂时不可用时保留可读占位，并在命令输出中报告降级资源。
- **不支持语法硬失败**：footnote、未适配 GFM Alert 等可能丢失语义的扩展会在远端调用前报告文件和行号。
- **批量失败可恢复**：`latest` 会继续处理后续文章，最后以成功/失败数量汇总，并在有失败时返回非零状态。

## 🔄 流程图 (Workflow)

### 开发者发布流 (CI/CD & Semantic Release)
```text
Feature/Fix branch -> reviewed squash PR -> main
                                         |
                           Friday/manual verification
                                         |
                       default-off stable publication
```

`main` 是唯一集成分支；普通 CI 与 PR 不发布。周五 07:00 UTC（北京时间 15:00）和手动入口复用候选验证与产物校验，稳定包通过同一归档发布到 npm 与 GitHub Packages。只有显式配置 `RELEASE_ENABLED=true` 才能启用；历史提交校验阻塞解除前保持禁用。版本和标签仅由 semantic-release 计算，不再运行 promotion、sync、beta 或 PR preview 发布。启用前置条件和部分发布恢复见 [Release train runbook](docs/release-train.md)。

### 写入安全与本地预检

- 查询可有限重试；创建、更新草稿及素材上传只尝试一次。网络故障后出现 `WRITE_RESULT_UNKNOWN` 时，应先在微信后台核对结果，再决定是否重试；`latest` 会停止当前批次。
- 先准备全部资源并检查可确定的错误，再上传。`publish-dir --all` 会先预检所有目录。覆盖确认取消时不上传素材。
- 最终 CDN URL 长度只能在上传后确认；真实 payload 仍会复检，临界超限可能留下已上传素材。工具会报告情况，不自动删除素材或回滚远端写入。
- Markdown 与 JSON 导出的本地图片都会验证真实内容并内联为 data URI；读取失败直接终止，技术代码示例保持原文。远端图片 URL 保持原有行为。SVG、未压缩 Windows BMP 会转换为 PNG，BMP 转换不再依赖 macOS；BMP 上限为 64 MiB、1600 万像素，压缩、bitfield 与 OS/2 编码会明确拒绝。
- 导出支持 Markdown 引用式图片；发布时请使用行内图片语法 `![说明](image.png)`。渲染后未被准备阶段绑定的图片会在任何微信上传前报错，避免遗漏资源。
- 旧缓存保留，不猜测其账号归属，也不自动导入新命名空间。升级后首次发布可能重新上传；缓存落盘失败会告警，但不会丢弃本次成功结果。多进程使用同一素材仍不承诺仅上传一次。

### 用户使用流 (CLI & WeChat Sync)
```text
      [ User Blog Project Root ]
      /           |            \
     /            |             \
[ .env ]  [ wechat.config.yml ] [ _posts/*.md ]
(Secrets)   (Public Config)      (Content)
    |             |                 |
    | gitignore   | git commit      |
    |             |                 |
    +-------------+-----------------+
                  |
         [ Run: wechat-pub sync ]
                  |
                  v
+---------------------------------------+
| wechat-publisher CLI Engine           |
|                                       |
|  1. Load Config (Merge Env + YAML)    |
|  2. Parse Markdown & Front-matter     |
|  3. Image Pipeline:                   |
|     - Local Img -> Upload to WeChat   |
|     - Mermaid   -> Render & Upload    |
|  4. High-Fidelity Rendering:          |
|     - HTML + CSS Inlining (Juice)     |
|     - Fix List Items (Remove <br>)    |
+---------------------------------------+
                  |
                  v
       [ WeChat API Server ]
                  |
        +---------+---------+
        |                   |
 [ Material Lib ]    [ Draft Box ]
 (Permanent Imgs)    (Final Post)
```

## 🚀 快速开始

### 1. 安装

#### 在 Mac 上安装 CLI 并预览第一篇稿

如果正在和 Codex 写稿，可以在当前对话说「帮我检查排版工具，装好后继续排刚才那篇」。先检查本机环境：

```bash
wechat-pub export --help
```

如果看到了 `export` 的用法和 `--output` 选项，可以直接排版。若终端提示找不到 `wechat-pub`，检查 Node.js 和 npm：

```bash
node --version
npm --version
```

CLI 需要 Node.js 22.14.0 或更高版本。若命令不存在或 Node.js 版本过低，从 [Node.js 官网](https://nodejs.org/en/download) 下载 macOS 的 LTS 安装包。用 Mac 的标准账户操作时，安装向导会在点击「安装」后要求管理员的用户名和密码。安装完成后打开一个新的终端窗口，再检查以上两个版本。环境满足要求后，运行以下命令安装 CLI。

```bash
npm install -g @rbbtsn0w/wechat-publisher
wechat-pub export --help
```

**如果全局安装报 `EACCES`**，当前账户无法写入 npm 的全局安装目录（例如 `/usr/local/lib/node_modules`）。可以用 npm 自带的 `npx` 继续导出，无需 `sudo` 或修改系统目录权限。

- **在 Codex 里继续。** 回到原对话，回复「全局安装报 EACCES，用 npx 继续排刚才那篇，只生成本地预览」。如果 CLI 已经装好，回复「继续排刚才那篇，只生成本地预览」。Agent 应在同一对话中使用之前保存的 Markdown 路径导出 HTML，再返回可以重新打开的本地文件链接。你可以继续使用原稿，无需重新粘贴正文，也无需微信 AppID 或 AppSecret。
- **在终端里继续。** 在原稿所在目录运行下方对应的命令，把 `article.md` 换成实际文件名。首次运行 `npx` 时，如果终端询问是否下载 `@rbbtsn0w/wechat-publisher`，输入 `y` 并按回车。

```bash
# 全局安装报 EACCES 时，在原稿所在目录运行
npx @rbbtsn0w/wechat-publisher export "article.md" --output "article-preview.html"
open "article-preview.html"
```

```bash
# 已经可以运行 wechat-pub 时，在原稿所在目录运行
wechat-pub export "article.md" --output "article-preview.html"
open "article-preview.html"
```

#### 方式二：从源码安装（适合开发者）
```bash
git clone https://github.com/RbBtSn0w/wechat-publisher.git
cd wechat-publisher
npm install
npm run build
npm link --force
```

### 2. 更新版本
`wechat-pub` 内置了自我更新命令（支持稳定版、Beta 版与开发版本）：
```bash
# 升级到最新稳定版本
wechat-pub update

# 升级到最新 Beta 版本
wechat-pub update --beta

# 升级到最新开发版本 (next)
wechat-pub update --dev

# 升级到指定 tag 或版本
wechat-pub update --tag canary
```

### 3. 项目初始化
在您的**博客项目根目录**运行：
```bash
wechat-pub init
```

### 4. 创建图文目录模板

`init --draft` 用于创建可交给 `publish-dir` 的目录 payload，不会调用微信 API。

```bash
# 标准长文章：目标目录中需已有封面图片
wechat-pub init \
  --draft news \
  --output ./wechat-drafts/my-article \
  --title "文章标题" \
  --content "<p>文章正文</p>" \
  --cover cover.jpg

# 图片消息：自动按文件名顺序枚举目标目录中的 JPG、PNG、GIF
wechat-pub init \
  --draft newspic \
  --output ./wechat-drafts/my-gallery \
  --title "图片合集" \
  --content "图片说明"
```

在交互式终端中可以省略标题、正文、封面或图片列表，CLI 会逐项询问。非交互环境缺少必填值时会直接报错并列出对应参数。已有 `draft.json` 默认不会覆盖；确认覆盖时显式添加 `--force`。

生成后先进行本地验证：

```bash
wechat-pub publish-dir ./wechat-drafts/my-gallery --dry-run
```

### 5. 配置参数
编辑生成的 `wechat.config.yml`：
```yaml
author: "博主名称"
siteUrl: "https://your-blog.me" # 必填：用于修复博文内相对链接
postsDir: "_posts"             # 博客文章目录
assetsDir: "assets"            # 静态资源根目录
```

同时，在生成的 `.env` 文件中配置您的凭证（`init` 命令会自动尝试将 `.env` 添加到 `.gitignore`）：
```env
WECHAT_APP_ID=您的微信AppID
WECHAT_APP_SECRET=您的微信AppSecret
```
*提示：请务必将运行机器的 IP 加入[微信公众平台后台的“IP白名单”](https://developers.weixin.qq.com/console/product/mp/wx1ef3c52fafa09019?tab1=basicInfo&tab2=dev)。*

## 📖 常用命令

> **注意**：请始终在您的博客项目根目录下运行以下指令。

- **同步指定文章**：
  ```bash
  wechat-pub sync _posts/2026-03-05-my-post.md
  ```
- **同步最近 5 篇文章（强制覆盖重复）**：
  ```bash
  wechat-pub latest 5 --force
  ```
- **本地预览 (不上传)**：
  ```bash
  wechat-pub sync _posts/my-post.md --dry-run
  ```
  *转换后的预览文件将生成在当前目录下的 `wechat-debug-[title].html`。*
  *dry-run 不要求微信凭证；它仍可能访问 Kroki 或外链图片以生成本地预览。*
- **列表查询**：
  ```bash
  wechat-pub list 10
  ```
- **目录 DSL 发布（1个 JSON + 图片目录）**：
  ```bash
  wechat-pub publish-dir ./wechat-drafts/my-draft
  ```
- **创建 `news` / `newspic` 目录模板**：
  ```bash
  wechat-pub init --draft newspic --output ./wechat-drafts/my-gallery
  ```
- **更新 CLI 工具版本**：
  ```bash
  wechat-pub update        # 升级至最新稳定版
  wechat-pub update --beta # 升级至最新 Beta 版
  wechat-pub update --dev  # 升级至最新开发版
  ```

## 📂 本地存储

- `wechat.config.yml`: 基础配置。
- `.env`: 敏感凭证，**请勿提交到版本库**。
- `.temp/resource-cache-v2/`: 按公众号与 API 地址隔离的上传缓存。
- `.wechat-cache.json`: 旧版缓存，保留但不再读取或导入。
- `.mermaid-cache/`: 存储生成的 Mermaid 图片。

---
*Developed by RbBtSn0w*
