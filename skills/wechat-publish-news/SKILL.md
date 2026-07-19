---
name: wechat-publish-news
description: Prepare, complete, validate, and publish WeChat article_type=news draft directories via wechat-pub publish-dir. Use for complete payloads or incomplete folders that require asking the user for missing title, content, cover, author, summary, or comment settings before local:// images are resolved and uploaded.
---

# WeChat Publish News

## Overview

Use this skill for directory-based publishing where JSON matches WeChat `draft/add` payload and article type is `news`.

## Intake

Inspect the directory, existing JSON, image files, and available author configuration before asking questions. Preserve valid existing values unless the user asks to replace them.

If information is missing, ask only for values that cannot be determined safely. Group missing fields into one concise question whenever possible. Never invent article content or silently choose a cover.

Collect or confirm:

- `title`: required; ask when missing.
- `content`: required HTML or a source that can be converted to HTML; ask when missing.
- `thumb_media_id`: required; when local images exist, list them and ask which is the cover.
- `author`: optional; use configured author when available, otherwise ask or omit.
- `digest`: optional; ask whether to provide one or derive a concise summary from supplied content.
- Comment settings: default both fields to `0` unless the user requests comments.

Example missing-information question:

```text
缺少标题、正文和封面。请提供标题与正文（或正文文件），并从 cover-a.jpg、cover-b.jpg 中选择封面。作者默认使用配置中的 rbbtsn0w，评论默认关闭。
```

## Required Payload Shape

- Directory contains exactly one `.json` file.
- JSON has non-empty `articles` array.
- For each news article:
  - `article_type` is `news` or omitted.
  - `thumb_media_id` exists. Use `local://<file>` when image is local.
  - `content` exists.

## Workflow

1. Inspect and complete the input.
- If no JSON exists, collect missing user-owned content and run `wechat-pub init --draft news --output <dir>` with known values supplied as flags. Let its interactive prompts collect anything still missing.
- If one JSON exists, fill only missing fields after asking the user.
- If multiple JSON files exist, stop and ask which payload should be used.
- Place referenced images in the same directory and use `local://filename` for local media.

```bash
wechat-pub init --draft news --output <dir> \
  --title "Title" --content "<p>Body</p>" --cover cover.jpg
```

2. Validate first.
```bash
wechat-pub publish-dir <dir> --dry-run
```
- Check dry-run output JSON path.
- Confirm placeholders are resolved as expected.
- Report the final title, author, cover, and comment settings.

3. Publish.
```bash
wechat-pub publish-dir <dir>
```
- Continue automatically only when the user's original request already authorized upload; otherwise ask before creating the remote draft.

## Example JSON Skeleton

```json
{
  "articles": [
    {
      "article_type": "news",
      "title": "Title",
      "author": "Author",
      "digest": "Summary",
      "content": "<p><img src=\"local://body.png\" /></p>",
      "thumb_media_id": "local://cover.jpg",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

## Validation Rules

- Fail if JSON count is not exactly one.
- Fail if `title` or `content` remains missing after intake.
- Fail if `thumb_media_id` is missing/empty for `news`.
- Fail if any `local://` file does not exist.
- Fail on API errors; do not silently downgrade.
