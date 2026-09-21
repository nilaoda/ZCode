import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ZCode 用户级数据根目录解析。
 *
 * 语义：`<数据基目录>/.zcode`。数据基目录的优先级与 `packages/services/src/paths.ts`
 * 的 `getDataBaseDir()` 保持一致：显式 `ZCODE_DATA_BASE_DIR` > `$HOME`/`%USERPROFILE%` > `homedir()`。
 *
 * 为什么需要这个模块：仓库里散落着大量 `join(homedir(), ".zcode", ...)` 与
 * `join(resolveUserHomeDir(), ".zcode", ...)`。它们都按真实家目录解析，因此在设置了
 * 自定义数据基目录（内网 / 自建发行版）时不会跟随，导致 `~/.zcode` 下的用户配置、
 * 日志、会话库仍与官方版共用。
 *
 * 本模块是这些路径的**唯一解析入口**。位于 `@zcode/shared/node`，因为
 * `apps/zcode-cli/*` 全树都不依赖 `@zcode/services`，只有 `@zcode/shared` 是公共依赖。
 *
 * 注意：
 * - 只替换 `.zcode` 相关的路径。`~/.claude`、`~/.agents`、`~/Library` 等跨工具或系统
 *   目录必须继续用真实家目录，不能走这里。
 * - 展开 `~/` 前缀（`path.slice(HOME_PREFIX.length)` 那类）也必须用真实家目录。
 * - `packages/services` 内部优先使用自身的 `getZCodeDataRootDir()`：它还额外支持
 *   运行时的 `setDataBaseDir()`，桌面主进程依赖该入口。桌面主进程在调用
 *   `setDataBaseDir()` 的同时会把同一个值写入 `ZCODE_DATA_BASE_DIR` 环境变量，
 *   使两套机制与子进程保持一致。
 */

export const ZCODE_DATA_BASE_DIR_ENV = "ZCODE_DATA_BASE_DIR";

type EnvLike = Record<string, string | undefined>;

/**
 * 桌面实例自己的 home 覆盖。
 *
 * 独立桌面实例（e2e / 多开调试）会设置它，让 `app.setPath("home")` 指向临时目录。
 * `settingService` 原先单独支持它，其它 `.zcode` 路径却不支持，导致同一实例的
 * 设置与其它数据落在两处。这里统一收口，使该实例的所有 `.zcode` 路径保持一致。
 * 未设置时对生产行为零影响。
 */
export const ZCODE_DESKTOP_HOME_DIR_ENV = "ZCODE_DESKTOP_HOME_DIR";

/** ZCode 自己的配置目录名。只有它跟随数据基目录；`.claude` / `.agents` / `.codex` 不跟随。 */
export const ZCODE_CONFIG_DIR_NAME = ".zcode";

/** 真实家目录。跨工具配置目录与 `~/` 前缀展开都必须用它。 */
export function resolveUserHomeDir(env: EnvLike = process.env): string {
  const envHome = env.HOME?.trim() || env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

/**
 * 解析数据基目录（`<基目录>/.zcode` 中的「基目录」）。
 *
 * 优先级：显式 `homeDirOverride` > `ZCODE_DATA_BASE_DIR` > `ZCODE_DESKTOP_HOME_DIR` > 家目录。
 *
 * `homeDirOverride` 放最前是为了保留 `resolveUserHomeDir(options)` 原有的注入语义
 * —— 调用方显式指定时应当压过环境变量。生产路径不会传它。
 */
export function resolveZCodeDataBaseDir(
  env: EnvLike = process.env,
  homeDirOverride?: string,
): string {
  return (
    homeDirOverride?.trim() ||
    env[ZCODE_DATA_BASE_DIR_ENV]?.trim() ||
    env[ZCODE_DESKTOP_HOME_DIR_ENV]?.trim() ||
    resolveUserHomeDir(env)
  );
}

/**
 * 解析 ZCode 用户级数据根目录，即 `<数据基目录>/.zcode`。
 *
 * 未设置自定义数据基目录时结果就是 `~/.zcode`，与改造前完全一致。
 */
export function resolveZCodeUserRootDir(
  env: EnvLike = process.env,
  homeDirOverride?: string,
): string {
  return join(resolveZCodeDataBaseDir(env, homeDirOverride), ZCODE_CONFIG_DIR_NAME);
}

/**
 * 按「配置目录路径段」选择基目录。
 *
 * 仓库里多处把不同工具的配置目录统一描述成路径段数组，例如
 * `[".zcode", "cli"]`、`[".claude", "commands"]`、`[".agents", "skills"]`。
 * 只有首段是 `.zcode` 时才跟随数据基目录；其余是**跨工具共享**目录
 * （Claude Code / Codex / agents 的约定），必须继续落在真实家目录 ——
 * 否则会把别的工具的配置搬到一个它们不认识的位置。
 */
export function resolveAgentConfigBaseDir(
  segments: readonly string[],
  env: EnvLike = process.env,
): string {
  return segments[0] === ZCODE_CONFIG_DIR_NAME
    ? resolveZCodeDataBaseDir(env)
    : resolveUserHomeDir(env);
}
