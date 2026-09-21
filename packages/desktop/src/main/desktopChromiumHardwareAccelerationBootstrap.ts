import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDefaultDataBaseDir } from "./desktopDataBaseDirBootstrap.js";

interface ChromiumHardwareAccelerationApp {
  disableHardwareAcceleration(): void;
}

/**
 * 读取该身份数据根下的 setting.json。
 *
 * 必须走身份默认基目录，而不是直接拼 `homedir()`：Local 身份的数据根是
 * `~/.zcode-local-home/.zcode`。若这里仍读 `~/.zcode/v2/setting.json`，
 * 用户在本地版里关掉硬件加速后设置写进自己的文件、启动时却读官方那份，
 * 表现为「改了不生效」。
 *
 * production / preview 的默认基目录就是 `homedir()`，行为与改造前完全一致。
 */
function resolveChromiumHardwareAccelerationSettingsFile(): string {
  return join(resolveDefaultDataBaseDir(), ".zcode", "v2", "setting.json");
}

function extractBootstrapChromiumHardwareAccelerationEnabled(rawValue: unknown): boolean {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return true;
  }

  const enabled = (
    rawValue as {
      desktopChromiumHardwareAccelerationEnabled?: unknown;
    }
  ).desktopChromiumHardwareAccelerationEnabled;
  return typeof enabled === "boolean" ? enabled : true;
}

function readBootstrapChromiumHardwareAccelerationEnabledFromDisk(
  settingsFile: string = resolveChromiumHardwareAccelerationSettingsFile(),
): boolean {
  if (!existsSync(settingsFile)) {
    return true;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapChromiumHardwareAccelerationEnabled(JSON.parse(raw));
  } catch {
    return true;
  }
}

export function applyEarlyChromiumHardwareAccelerationBootstrap(
  app: ChromiumHardwareAccelerationApp,
  rawSettings?: unknown,
): boolean {
  const enabled =
    rawSettings === undefined
      ? readBootstrapChromiumHardwareAccelerationEnabledFromDisk()
      : extractBootstrapChromiumHardwareAccelerationEnabled(rawSettings);
  if (!enabled) {
    // Electron 只能在 app ready 前关闭 Chromium 硬件加速。
    // 因此设置页保存后必须在下一次 main 进程最早期读取并应用，不能等到 whenReady。
    app.disableHardwareAcceleration();
  }
  return enabled;
}
