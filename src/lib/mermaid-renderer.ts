import { MermaidRenderer as SdkMermaidRenderer } from '@rbbtsn0w/wechat-markdown';
import { TEMP_PATHS } from './constants';

export class MermaidRenderer extends SdkMermaidRenderer {
  constructor() {
    super(TEMP_PATHS.mermaid);
  }
}
