# publish-dir Templates

## Usage

1. Put the required images in the target directory.
2. Generate a payload interactively:

```bash
wechat-pub init --draft news --output ./your-dir
wechat-pub init --draft newspic --output ./your-dir
```

For automation, provide required values as flags such as `--title`, `--content`, `--cover`, and `--images`. Existing `draft.json` files require `--force` before they can be overwritten.

3. Validate and publish:

```bash
wechat-pub publish-dir ./your-dir --dry-run
wechat-pub publish-dir ./your-dir
```

## Notes

- Exactly one `.json` file is allowed in each publish directory.
- `local://filename` paths are resolved relative to that directory.
- Image paths outside the draft directory are rejected.
- `newspic` images are automatically discovered in stable filename order when `--images` is omitted.
