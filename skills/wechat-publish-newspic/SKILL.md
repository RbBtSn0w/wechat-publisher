---
name: wechat-publish-newspic
description: Publish WeChat draft payload directories for article_type=newspic via wechat-pub publish-dir. Use when payload JSON includes image_info.image_list and local images must be uploaded to permanent media IDs from local:// placeholders.
---

# WeChat Publish Newspic

## Overview

Use this skill for `article_type=newspic` directory payload publishing.
Ensure `image_info.image_list` is valid and local placeholders are resolvable.

## Required Input Shape

- Directory contains exactly one `.json` file.
- JSON has non-empty `articles` array.
- For each newspic article:
  - `article_type` is `newspic`.
  - `content` exists.
  - `image_info.image_list` exists and length is 1..20.
  - Each `image_media_id` is existing media ID or `local://<file>`.

## Workflow

1. Prepare payload directory.
- Put one JSON and all required images in the same directory.
- Use `local://filename` in `image_media_id` entries.

2. Validate first.
```bash
wechat-pub publish-dir <dir> --dry-run
```
- Confirm placeholder count and resolved output JSON.

3. Publish.
```bash
wechat-pub publish-dir <dir>
```

## Example JSON Skeleton

```json
{
  "articles": [
    {
      "article_type": "newspic",
      "title": "Title",
      "author": "Author",
      "content": "Text body",
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

## Validation Rules

- Fail if `image_info` or `image_list` is missing.
- Fail if `image_list` is empty or exceeds 20 items.
- Fail if `local://` points to missing file.
- Fail on API errors; do not continue with partial data.
