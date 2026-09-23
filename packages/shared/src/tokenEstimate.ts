import { ESTIMATED_TOKEN_CHAR_DIVISOR } from "./usage-stats.js";

/**
 * 估算文本的 token 数量。
 *
 * 中文字符按两个估算字符计入 —— 同一个字在多数 tokenizer 下比一个 ASCII 字符占更多 token。
 * 这是粗略换算，够调试与实时读数用，**不能替代** provider 上报的真实 usage。
 *
 * 放在 shared 是为了让 UI 与 CLI 共用同一套换算：此前只存在于
 * `apps/zcode-cli/packages/core/src/context/utils.ts`，而 UI 包引用不到 CLI，
 * 各写一份必然漂移。CLI 侧保留原导入路径（`context/utils.js`）re-export，
 * 因此既有调用点无需改动。
 */
export function estimateTokens(text: string): number {
  // 中文字符通常比英文字符占用更多 token，因此按两个估算字符计入。
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil((chineseChars * 2 + otherChars) / ESTIMATED_TOKEN_CHAR_DIVISOR);
}
