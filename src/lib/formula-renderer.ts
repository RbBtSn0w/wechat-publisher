import { FormulaRenderer as SdkFormulaRenderer } from '@rbbtsn0w/wechat-markdown';
import { TEMP_PATHS } from './constants';

export class FormulaRenderer extends SdkFormulaRenderer {
  constructor() {
    super(TEMP_PATHS.formula);
  }
}
