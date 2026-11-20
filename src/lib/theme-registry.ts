import { registerTheme } from '@rbbtsn0w/wechat-markdown';
import { techTheme } from './themes/tech';
import { appleTheme } from './themes/apple';

export const LEGACY_THEME_NAME = 'wechat-publisher-legacy';
export const APPLE_THEME_NAME = 'apple';

// Register publisher-owned themes once in this dedicated module.
registerTheme(LEGACY_THEME_NAME, techTheme);
registerTheme(APPLE_THEME_NAME, appleTheme);

const NAMED_THEMES: Record<string, string> = {
  apple: APPLE_THEME_NAME,
  grace: 'grace',
  geek: 'geek',
  'modern-tech': 'tech',
};

/**
 * Resolve a configured style name to a registered SDK theme.
 * Keeps `default`, `tech`, and unknown values mapped to the legacy theme
 * so existing publisher configurations remain visually unchanged unless opted in.
 */
export function resolvePublisherTheme(style?: string): string {
  if (!style) return LEGACY_THEME_NAME;
  const normalized = style.trim().toLowerCase();
  return Object.hasOwn(NAMED_THEMES, normalized) ? NAMED_THEMES[normalized] : LEGACY_THEME_NAME;
}
