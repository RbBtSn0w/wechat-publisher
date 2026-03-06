# WeChat Post Publisher

这是一个基于 Node.js (TypeScript) 开发的命令行工具 (CLI)，旨在帮助博主将本地的 Jekyll Markdown 文章一键同步至微信公众号的**草稿箱**。

它能自动处理最繁琐的图片上传、排版兼容和链接转换工作，让你只需关注内容创作。

## 🌟 核心特性

- **元数据智能提取**：自动解析 Jekyll Front-matter，识别标题、作者、封面图和摘要。
- **自动化媒体管道**：
  - 自动提取正文图片并上传至微信 CDN。
  - 支持封面图（永久素材）自动上传。
  - **断点续传缓存**：记录已上传资源，避免重复调用 API 节省配额。
- **完美排版兼容**：
  - **CSS 内联化**：使用 `Juice` 将样式直接注入标签，解决微信过滤外部样式的问题。
  - **链接修复**：自动将博文内的相对链接转换为指向你站点的绝对链接。
  - **内容清洗**：自动剔除不兼容的 `id` 和 `class` 属性，显著提升同步成功率。
- **防重复检测**：基于文章标题检索草稿箱，提供交互式的覆盖或新建确认。

## 🛠 工作流程

1.  **解析 (Parsing)**：读取 Markdown，提取元数据并自动截断超过 64 字符的摘要。
2.  **资源处理 (Assets)**：定位本地 `assets/` 图片，调用 `uploadimg` 接口同步到微信 CDN。
3.  **转换 (Conversion)**：Markdown 转 HTML -> CSS 内联 (Inlining) -> 相对路径补全。
4.  **检测 (Duplicate Check)**：对比微信草稿箱标题，确认是否存在冲突。
5.  **同步 (Sync)**：打包 JSON 数据，调用 `draft/add` API 创建微信草稿。

## 🚀 快速开始

### 1. 安装
```bash
cd wechat-publisher
npm install
npm run build
npm link --force
```

### 2. 配置
在 `wechat-publisher/` 目录下创建 `.wechat.yml`（该文件已被 git 忽略）：
```yaml
appId: "您的微信AppID"
appSecret: "您的微信AppSecret"
author: "您的名称"
siteUrl: "https://rbbtsn0w.me" # 用于修复相对链接
postsDir: "_posts"
assetsDir: "assets"
style: "default"
```
*提示：请务必在微信公众号后台将运行本工具的机器 IP 加入“IP白名单”。*

### 3. 常用命令

建议在博客根目录下执行：

- **同步文章**：
  ```bash
  wechat-pub sync _posts/2026-03-05-your-post.md
  ```
- **本地预览 (Dry Run)**：
  ```bash
  wechat-pub sync _posts/2026-03-05-your-post.md --dry-run
  ```
  *预览结果将保存为 `wechat-publisher/debug.html`。*
- **强制同步**：
  ```bash
  wechat-pub sync _posts/2026-03-05-your-post.md --force
  ```
- **查看最近草稿**：
  ```bash
  wechat-pub list 10
  ```

## 📂 本地存储

- `.wechat.yml`: 存储敏感 API 凭证。
- `.wechat-cache.json`: 存储 `本地路径 -> 微信URL` 的映射。若图片显示异常或需要强制刷新，可删除此文件。

## ❓ 常见问题

- **错误 45166 (Invalid Content)**：通常是因为包含 iframe 或不支持的 HTML 标签。
- **错误 45004 (Digest Limit)**：摘要超过微信限制，工具目前已支持自动截断。
- **图片无法显示**：确保图片位于 `assets/` 路径下并在 Markdown 中引用正确。

## 📜 详细文档
更多细节请参阅 [规格说明书](../specs/002-wechat-post-publisher/spec.md) 或 [快速入门指南](../specs/002-wechat-post-publisher/quickstart.md)。
