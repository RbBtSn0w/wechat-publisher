---
name: wechat-publish-markdown
description: Publish Markdown blog posts to WeChat Official Account draft box with wechat-pub sync/latest/list workflows. Use when tasks involve Markdown files, front-matter parsing, dry-run preview, batch publishing, duplicate draft overwrite decisions, or listing recent drafts.
---

# WeChat Publish Markdown

## Overview

Use this skill to publish Markdown articles through `wechat-pub` CLI using `sync`, `latest`, and `list`.
Prefer dry-run first, then publish.

## Workflow

1. Verify tool and config.
- Ensure `wechat-pub` is available.
- Ensure `.env` or env vars include valid `WECHAT_APP_ID` and `WECHAT_APP_SECRET`.

2. Choose command by intent.
- Single article: `wechat-pub sync <post-path>`
- Batch latest N: `wechat-pub latest <n> [--force]`
- Inspect drafts: `wechat-pub list [count]`

3. Run dry-run before real publish when content changed heavily.
- `wechat-pub sync <post-path> --dry-run`
- Inspect generated debug HTML path from output.

4. Publish and handle duplicates.
- Use `--force` only when overwrite is intended.
- Without `--force`, confirm interactive overwrite prompt.

## Command Patterns

```bash
wechat-pub sync _posts/2026-03-05-my-post.md
wechat-pub sync _posts/2026-03-05-my-post.md --dry-run
wechat-pub latest 5 --force
wechat-pub list 10
```

## Validation Rules

- Fail if target Markdown file does not exist.
- Fail if credentials/config are missing.
- Treat API errors as hard failures and surface `errcode/errmsg`.

## Troubleshooting

- `Missing WeChat AppID or AppSecret`: fix `.wechat.yml` or env vars.
- `File not found`: fix post path or current working directory.
- Rejected draft due to cover: ensure valid cover image and `thumb_media_id` flow.
