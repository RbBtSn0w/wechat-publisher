import { techTheme } from './tech';

export function getTheme(style: string = 'tech'): string {
  // We currently only support 'tech' as it's the primary theme used.
  // This remains extensible for future additions.
  return techTheme;
}
