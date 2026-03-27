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
*提示：请务必将运行机器的 IP 加入[微信公众平台后台的“IP白名单”](https://developers.weixin.qq.com/console/product/mp/wx1ef3c52fafa09019?tab1=basicInfo&tab2=dev)。*

### 4. 文章 Front-matter（可选）
支持通过 Front-matter 指定微信公众号草稿文章类型：

```yaml
---
title: "示例文章"
article_type: "news"    # 可选: news | newspic（默认 news）
---
```

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
- **目录 DSL 发布（1个 JSON + 图片目录）**：
  ```bash
  wechat-pub publish-dir ./wechat-drafts/my-draft
  wechat-pub publish-dir ./wechat-drafts/my-draft --dry-run
  ```

### 5. 目录 DSL 输入（`publish-dir`）

- 目录内要求：**恰好 1 个 JSON 文件**，可包含多张图片。
- JSON 结构与微信 `draft/add` 官方请求体对齐（重点是 `articles`）。
- 本地图片占位使用 `local://文件名`，发布时会自动上传并回填：
  - `news`: `thumb_media_id` 支持 `local://...`（回填永久 `media_id`）
  - `newspic`: `image_info.image_list[].image_media_id` 支持 `local://...`（回填永久 `media_id`）
  - `content` 中出现的 `local://...` 会上传为正文图片 URL 并替换

### 6. `publish-dir` 完整教程

#### 6.1 目录结构

```text
wechat-drafts/
  my-news/
    draft.json
    cover.jpg
    body-1.png
  my-newspic/
    draft.json
    pic-1.jpg
    pic-2.jpg
```

> 一个目录只放一个 JSON（比如 `draft.json`），其余是图片文件。

#### 6.2 `news` 模板（图文消息）

参考模板文件：`templates/publish-dir/news/draft.json`

```json
{
  "articles": [
    {
      "article_type": "news",
      "title": "示例图文消息",
      "author": "RbBtSn0w",
      "digest": "这是一个图文消息示例",
      "content": "<h1>正文标题</h1><p>正文图片：<img src=\"local://body-1.png\" /></p>",
      "thumb_media_id": "local://cover.jpg",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

#### 6.3 `newspic` 模板（图片消息）

参考模板文件：`templates/publish-dir/newspic/draft.json`

```json
{
  "articles": [
    {
      "article_type": "newspic",
      "title": "示例图片消息",
      "author": "RbBtSn0w",
      "content": "这是一条图片消息正文",
      "image_info": {
        "image_list": [
          { "image_media_id": "local://pic-1.jpg" },
          { "image_media_id": "local://pic-2.jpg" }
        ]
      },
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

#### 6.4 执行命令

```bash
# 仅校验并生成回填结果（不会调用微信接口）
wechat-pub publish-dir ./wechat-drafts/my-news --dry-run

# 正式发布到草稿箱
wechat-pub publish-dir ./wechat-drafts/my-news
```

#### 6.5 字段回填规则

- `thumb_media_id: "local://cover.jpg"` -> 自动上传永久素材，替换为 `media_id`。
- `image_media_id: "local://pic-1.jpg"` -> 自动上传永久素材，替换为 `media_id`。
- `content` 中 `local://xxx` -> 自动上传正文图片（`uploadimg`），替换为图片 URL。

#### 6.6 常见报错排查

- `Expected exactly one JSON file ...`：目录里 JSON 不是 1 个。
- `Referenced local file not found ...`：`local://` 对应文件不存在。
- `articles[x].thumb_media_id must be a non-empty string`：`news` 缺少封面字段。
- `image_list exceeds 20 images`：`newspic` 图片超过微信限制（最多 20）。

## 📂 本地存储

- `.wechat.yml`: 敏感凭证。
- `.wechat-cache.json`: 图片与 URL 映射缓存。
- `.mermaid-cache/`: 存储生成的 Mermaid 图片。

---
*Developed by RbBtSn0w*
