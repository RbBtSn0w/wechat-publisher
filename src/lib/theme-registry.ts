import { registerTheme } from '@rbbtsn0w/wechat-markdown';
import { techTheme } from './themes/tech';

export const LEGACY_THEME_NAME = 'wechat-publisher-legacy';

// Register the publisher's legacy theme once in this dedicated module
registerTheme(LEGACY_THEME_NAME, techTheme);
