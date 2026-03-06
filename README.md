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
- **智能缓存系统**：利用 `.wechat-cache.json` 记录已上传资源，避免重复调用 API，节省配额并加速同步。

### 3. 🎨 高保真排版兼容
- **结构保真渲染**：采用 GitHub 风格（GFM）样式表，确保本地预览与手机端效果高度一致。
- **CSS 内联化 (Inlining)**：使用 `Juice` 将样式直接注入标签，绕过微信对外部样式的严格限制。
- **列表兼容补丁**：深度剔除 `<ul>`/`<ol>` 与 `<li>` 标签间的换行符（`\n`），彻底修复微信编辑器自动插入 `<section><br></section>` 导致的多余黑点（Phantom Bullets）问题；同时调整 `list-style-position` 确保移动端缩进呈现完美对齐。
- **绝对链接转换**：自动将站内相对链接转换为绝对链接（基于 `siteUrl` 配置）。
- **健壮性净化**：自动移除 `id`、`class` 属性，并截断超限的标题与摘要，确保符合微信 API 规范。

## 🛠 工作流程

1.  **解析 (Parsing)**：读取 Markdown 提取元数据，自动处理超长标题和摘要。
2.  **渲染 (Rendering)**：
    - 将 **Mermaid** 代码块通过远程服务转为图片并缓存。
    - 定位本地图片并同步到微信 CDN。
3.  **转译 (Conversion)**：Markdown 转 HTML，执行 CSS 内联及链接补全。
4.  **校验 (Validating)**：查询微信后台草稿列表，处理命名冲突。
5.  **发布 (Publishing)**：通过微信 API (`draft/add` 或 `draft/update`) 创建/覆盖草稿。

## 🚀 快速开始

### 1. 全局安装
```bash
# 进入工具目录
cd wechat-publisher
npm install
npm run build
npm link --force
```

### 2. 项目初始化
在您的**博客项目根目录**运行：
```bash
wechat-pub init
```

### 3. 配置参数
编辑生成的 `.wechat.yml`：
```yaml
appId: "您的微信AppID"
appSecret: "您的微信AppSecret"
author: "博主名称"
siteUrl: "https://your-blog.me" # 必填：用于修复博文内相对链接
postsDir: "_posts"             # 博客文章目录
assetsDir: "assets"            # 静态资源根目录
```
*提示：请务必将运行机器的 IP 加入微信公众平台后台的“IP白名单”。*

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
- **列表查询**：
  ```bash
  wechat-pub list 10
  ```

## 📂 本地存储

- `.wechat.yml`: 敏感凭证。
- `.wechat-cache.json`: 图片与 URL 映射缓存。
- `.mermaid-cache/`: 存储生成的 Mermaid 图片。

---
*Developed by RbBtSn0w*
