---
name: wechat-publish-newspic
description: Prepare, complete, validate, and publish WeChat article_type=newspic draft directories via wechat-pub publish-dir. Use for complete payloads or image folders that require asking the user for missing title, caption, author, image selection or order, and comment settings before local:// images are resolved and uploaded.
---

# WeChat Publish Newspic

## Overview

Use this skill for `article_type=newspic` directory payload publishing.
Ensure `image_info.image_list` is valid and local placeholders are resolvable.

## Intake

Inspect the directory, existing JSON, image files, and available author configuration before asking questions. Preserve valid existing values unless the user asks to replace them.

If information is missing, ask only for values that cannot be determined safely. Group missing fields into one concise question whenever possible. Never invent a title or caption.

Collect or confirm:

- `title`: required; ask when missing.
- `content`: required caption/body text; ask when missing.
- `image_info.image_list`: required; when JSON is absent, enumerate supported image files in stable filename order and ask the user to confirm selection and order.
- `author`: optional; use configured author when available, otherwise ask or omit.
- Comment settings: default both fields to `0` unless the user requests comments.

Example missing-information question:

```text
发现 3 张图片，将按 01.png、02.png、03.png 排列。请确认顺序，并提供标题和图片说明；作者默认使用配置中的 rbbtsn0w，评论默认关闭。
```

## Required Payload Shape

- Directory contains exactly one `.json` file.
- JSON has non-empty `articles` array.
- For each newspic article:
  - `article_type` is `newspic`.
  - `content` exists.
  - `image_info.image_list` exists and length is 1..20.
  - Each `image_media_id` is existing media ID or `local://<file>`.

## Workflow

1. Inspect and complete the input.
- If no JSON exists, enumerate images, collect missing user-owned content, and run `wechat-pub init --draft newspic --output <dir>` with known values supplied as flags. Let its interactive prompts collect anything still missing.
- If one JSON exists, fill only missing fields after asking the user.
- If multiple JSON files exist, stop and ask which payload should be used.
- Put referenced images in the same directory and use `local://filename` in `image_media_id` entries.

```bash
wechat-pub init --draft newspic --output <dir> \
  --title "Title" --content "Caption"
```

2. Validate first.
```bash
wechat-pub publish-dir <dir> --dry-run
```
- Confirm placeholder count and resolved output JSON.
- Report the final title, author, image count and order, and comment settings.

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
- Fail if `title` or `content` remains missing after intake.
- Fail if `image_list` is empty or exceeds 20 items.
- Fail if `local://` points to missing file.
- Fail on API errors; do not continue with partial data.
