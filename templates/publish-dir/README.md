# publish-dir Templates

## Usage

1. Copy either `news/draft.json` or `newspic/draft.json` into your target directory.
2. Put image files referenced by `local://...` in the same directory.
3. Run:

```bash
wechat-pub publish-dir ./your-dir --dry-run
wechat-pub publish-dir ./your-dir
```

## Notes

- Exactly one `.json` file is allowed in each publish directory.
- `local://filename` paths are resolved relative to that directory.
