---
name: wechat-publish-news
description: Publish WeChat draft payload directories for article_type=news via wechat-pub publish-dir. Use when input is one folder containing one JSON payload and local images that must be uploaded and resolved from local:// placeholders.
---

# WeChat Publish News

## Overview

Use this skill for directory-based publishing where JSON matches WeChat `draft/add` payload and article type is `news`.

## Required Input Shape

- Directory contains exactly one `.json` file.
- JSON has non-empty `articles` array.
- For each news article:
  - `article_type` is `news` or omitted.
  - `thumb_media_id` exists. Use `local://<file>` when image is local.
  - `content` exists.

## Workflow

1. Prepare payload directory.
- Place JSON and referenced local images in the same directory.
- Use `local://filename` in `thumb_media_id` and content image sources when local files are needed.

2. Validate first.
```bash
wechat-pub publish-dir <dir> --dry-run
```
- Check dry-run output JSON path.
- Confirm placeholders are resolved as expected.

3. Publish.
```bash
wechat-pub publish-dir <dir>
```

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
- Fail if `thumb_media_id` is missing/empty for `news`.
- Fail if any `local://` file does not exist.
- Fail on API errors; do not silently downgrade.
