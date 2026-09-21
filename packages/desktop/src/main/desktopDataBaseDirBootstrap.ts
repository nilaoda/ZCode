import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setDataBaseDir } from "@zcode/services/node";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { desktopProductIdentities } from "../../scripts/desktop-product-identity.mjs";

/**
 * 该产品身份默认使用的数据基目录。
 *
 * 业务数据落在 `<基目录>/.zcode`（见 `packages/services/src/paths.ts` 的 getZCodeDataRootDir）。
 *
 * - `production` / `preview`：沿用 `$HOME`，即 `~/.zcode`。
 *   Preview **有意**与正式版共享任务、配置和凭据（见 desktopRuntimeEnv 中
 *   `ZCODE_CUA_HELPER_INSTALL_VARIANT` 附近的注释），因此这里必须保持 `$HOME`，
 *   不能顺手改成隔离 —— 那会破坏上游既有的 Preview 语义。
 * - `local`：改用独立基目录 `~/.zcode-local-home`，使自建发行版**安装后无需任何环境变量**
 *   即可与官方版完全隔离：任务、设置、凭据、官方插件缓存分片都各走一套。
 *   命名沿用仓库既有的 `~/.zcode-dev-home` 约定。
 *
 * 身份取自编译期常量而非 `process.env`：身份开关只在构建期存在，打包后进程环境里没有它们。
 */
export function resolveDefaultDataBaseDir(flavor = ZCODE_PRODUCT_FLAVOR): string {
  const dataBaseDirName = desktopProductIdentities[flavor]?.dataBaseDirName;
  return dataBaseDirName ? join(homedir(), dataBaseDirName) : homedir();
}

/**
 * 读取「引导设置文件」的位置。
 *
 * 该文件用于把用户自定义的 dataBaseDir 从默认位置带到启动早期。它必须从**该身份的默认
 * 基目录**读取：Local 身份若去读官方版的 `~/.zcode/v2/setting.json`，会把官方版自定义的
 * 数据目录继承过来，隔离立刻失效。
 *
 * 对 production / preview 而言，这里等价于原先的 `homedir()`，行为不变。
 */
function resolveBootstrapSettingsFile(): string {
  return join(resolveDefaultDataBaseDir(), ".zcode", "v2", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
    return dataBaseDir;
  }

  // 没有引导设置时，按身份落到默认基目录。
  // 显式 ZCODE_DATA_BASE_DIR 由 getDataBaseDir() 处理，**不能**在这里覆盖它：
  // setDataBaseDir() 的优先级高于环境变量，无条件调用会吞掉用户显式指定的目录。
  if (process.env.ZCODE_DATA_BASE_DIR?.trim()) {
    return null;
  }

  const identityDefault = resolveDefaultDataBaseDir();
  // production / preview 的默认值就是 $HOME，无需显式设置，保持与改造前完全一致。
  if (identityDefault === homedir()) {
    return null;
  }

  setDataBaseDir(identityDefault);
  return identityDefault;
}
