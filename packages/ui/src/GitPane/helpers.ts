import type { GitChangeSourceId, GitDiffResult } from "@zcode/shared";
import { getFiletypeFromFileName } from "@pierre/diffs";
import {
  getPatchPreviewLineContent,
  getPlainTextPatchContentLines,
  getPlainTextPatchFallbackLines,
  parseTruncatedMarkerOmittedLineCount,
} from "@/lib/patchDiffPreview.js";

const MAX_RICH_DIFF_FULL_CONTENT_CHAR_COUNT = 180_000;
const MAX_RICH_DIFF_FULL_CONTENT_LINE_COUNT = 1_200;

type GitPaneDiffPreviewPlan =
  | {
      kind: "rich";
    }
  | {
      kind: "patch";
    }
  | {
      kind: "plain-text";
      lines: string[];
    };

export function getSourceMessageId(sourceId: GitChangeSourceId): string {
  switch (sourceId) {
    case "unstaged":
      return "git.source.unstaged";
    case "staged":
      return "git.source.staged";
    case "branch":
      return "git.source.branch";
    case "last-turn":
      return "git.source.lastTurn";
    default:
      return "git.source.unstaged";
  }
}

export function getDiffFallbackMessageId(availability: GitDiffResult["availability"]): string {
  switch (availability) {
    case "binary":
      return "git.diff.binaryTitle";
    case "truncated":
      return "git.diff.truncatedTitle";
    default:
      return "git.diff.unavailableTitle";
  }
}

export function getDiffCacheKey(sourceId: GitChangeSourceId, path: string): string {
  return `${sourceId}:${path}`;
}

export function getGitPaneDiffFindContent(diff: GitDiffResult | null): string | null {
  if (diff?.availability !== "patch") {
    return null;
  }

  if (diff.beforeContent !== null && diff.afterContent !== null) {
    return `${diff.beforeContent}\n${diff.afterContent}`;
  }

  if (diff.patch) {
    const previewPlan = getGitPaneDiffPreviewPlan(diff);
    const visibleLines =
      previewPlan.kind === "plain-text"
        ? previewPlan.lines
        : getPlainTextPatchContentLines(diff.patch);

    // 全文内容降级后若直接搜索原始 patch，Git 文件头、index 和 hunk 头会
    // 产生预览中不存在的伪命中。查找必须复用实际可见行，并剥掉不会显示的 diff marker。
    return visibleLines
      .filter((line) => parseTruncatedMarkerOmittedLineCount(line) === null)
      .map(getPatchPreviewLineContent)
      .join("\n");
  }

  if (diff.beforeContent === null && diff.afterContent === null) {
    return null;
  }

  return `${diff.beforeContent ?? ""}\n${diff.afterContent ?? ""}`;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return String(error);
}

function countLogicalLines(content: string | null): number {
  if (!content) {
    return 0;
  }

  let lineCount = content.endsWith("\n") ? 0 : 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }

  return lineCount;
}

/** 交叉校验的保守门槛：低于这个行数不判定，避免小文件噪声。 */
const PAIR_CONTRADICTION_MIN_LINES = 20;
/** 内容对隐含的改动量要超过 patch 改动量这么多倍，才判定两者不可比。 */
const PAIR_CONTRADICTION_PATCH_FACTOR = 5;

/**
 * 两侧内容与 git patch 是否严重矛盾。
 *
 * 兜的是「视图说整文件都变了、git 的计数却说只改了 4 行」这类错位（已证实的成因是
 * 行尾归一化不一致，两侧读取已在服务端统一，这里是消费端的安全网）。与其渲染一个
 * 吓人的假 diff，不如退回 git 的权威结果。
 *
 * 判据刻意保守：用「before 里有、after 里没有」的行数（**集合差**，不是真正的 diff）
 * 作为内容对隐含改动量的**下界**，只有它同时满足
 * 1. 至少占 before 的一半行，且
 * 2. 超过 patch 改动行数的 PAIR_CONTRADICTION_PATCH_FACTOR 倍
 * 才判定不可比。集合差只会低估改动量，所以正常 diff 几乎不可能误触发。
 */
function contentPairContradictsPatch(diff: GitDiffResult): boolean {
  const before = diff.beforeContent;
  const after = diff.afterContent;
  if (before === null || after === null || !diff.patch) {
    return false;
  }

  const beforeLines = before.split("\n");
  if (beforeLines.length < PAIR_CONTRADICTION_MIN_LINES) {
    return false;
  }

  const afterLines = new Set(after.split("\n"));
  let missing = 0;
  for (const line of beforeLines) {
    if (!afterLines.has(line)) {
      missing += 1;
    }
  }

  if (missing * 2 < beforeLines.length) {
    return false;
  }

  return missing > countPatchChangedLines(diff.patch) * PAIR_CONTRADICTION_PATCH_FACTOR;
}

/**
 * patch 里真正的增删行数。
 *
 * 只在第一个 `@@` 之后统计：`---` / `+++` 文件头只出现在它之前，而 hunk 里被删除的
 * 行完全可能以 `--` 开头（如 Markdown 分隔线），按前缀跳过会漏计。
 */
function countPatchChangedLines(patch: string): number {
  let changed = 0;
  let inHunks = false;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      inHunks = true;
      continue;
    }
    if (!inHunks) {
      continue;
    }
    if (line.startsWith("+") || line.startsWith("-")) {
      changed += 1;
    }
  }

  return changed;
}

function shouldRenderPatchOnlyGitDiffPreview(diff: GitDiffResult): boolean {
  if (diff.availability !== "patch" || !diff.patch) {
    return false;
  }

  // Repo 全文读取失败时 patch 仍然有效，但缺失的一侧不能再补成空文件交给
  // MultiFileDiff。把“不完整内容对”并入既有 patch 安全预检，避免整文件误判为增删。
  if (diff.beforeContent === null || diff.afterContent === null) {
    return true;
  }

  // 交叉校验：内容对隐含的改动量远大于 git patch 的改动量时，两侧内容不可比，
  // 改走 patch —— git 的结果总是权威的。见 contentPairContradictsPatch。
  if (contentPairContradictsPatch(diff)) {
    return true;
  }

  const fullContentCharCount = (diff.beforeContent?.length ?? 0) + (diff.afterContent?.length ?? 0);
  if (fullContentCharCount > MAX_RICH_DIFF_FULL_CONTENT_CHAR_COUNT) {
    return true;
  }

  const fullContentLineCount = Math.max(
    countLogicalLines(diff.beforeContent),
    countLogicalLines(diff.afterContent),
  );

  return fullContentLineCount > MAX_RICH_DIFF_FULL_CONTENT_LINE_COUNT;
}

export function getGitPaneDiffPreviewPlan(diff: GitDiffResult | null): GitPaneDiffPreviewPlan {
  if (diff?.availability !== "patch" || !diff.patch) {
    return { kind: "rich" };
  }

  const reviewFallbackLines = shouldRenderPlainTextDiffPreview(diff.patch);
  if (reviewFallbackLines) {
    return {
      kind: "plain-text",
      lines: reviewFallbackLines,
    };
  }

  if (!shouldRenderPatchOnlyGitDiffPreview(diff)) {
    return { kind: "rich" };
  }

  const fullPatchFallbackLines = getPlainTextPatchFallbackLines(diff.patch);
  if (fullPatchFallbackLines) {
    return {
      kind: "plain-text",
      lines: fullPatchFallbackLines,
    };
  }

  // Review 面板展开大文件时，MultiFileDiff 会在 React render 阶段同步比较
  // before/after 整文件，并在初始高亮前构建整文件 plain AST。大文件只需要先看变更 hunk，
  // 因此超阈值时改走 PatchDiff，保留异步高亮 worker，同时避开整文件主线程开销。
  return { kind: "patch" };
}

function shouldRenderPlainTextDiffPreview(patch: string): string[] | null {
  const fallbackLines = getPlainTextPatchFallbackLines(patch);
  if (!fallbackLines) {
    return null;
  }

  const lines = patch.split(/\r?\n/);
  const isCreatedOrDeletedPatch =
    lines.some((line) => line === "--- /dev/null") ||
    lines.some((line) => line === "+++ /dev/null");
  if (!isCreatedOrDeletedPatch) {
    return fallbackLines;
  }

  const patchFileName = getPatchContentFileName(lines);
  if (!patchFileName) {
    return null;
  }

  // review 面板只该把纯文本新增/删除文件降级成轻量 preview。
  // 底层通用 fallback 为了避免文件变更展开空白，会覆盖 JSON 等结构化文件；
  // 这里重新按文件类型收口，避免结构化文件绕过 PatchDiff 的语义化渲染路径。
  return getFiletypeFromFileName(patchFileName) === "text" ? fallbackLines : null;
}

function getPatchContentFileName(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) {
      continue;
    }

    const fileName = line.slice(4).trim();
    if (!fileName || fileName === "/dev/null") {
      continue;
    }

    return fileName;
  }

  return null;
}
