import armsRum from "@arms/rum-electron";
import {
  isProductEndpointDisabled,
  ZCODE_ARMS_RUM_ENDPOINT,
  ZCODE_LOCAL_ONLY_BUILD,
} from "@zcode/shared";

export const desktopArmsTelemetryEnabled =
  !ZCODE_LOCAL_ONLY_BUILD && !isProductEndpointDisabled() && ZCODE_ARMS_RUM_ENDPOINT !== "";

// 修复原因：内网版跳过 SDK 初始化后，setConfig/getConfig 会抛出 Config not initialized，
// 使启动停在创建托盘之后。业务出口统一短路，不能靠初始化遥测来换取窗口正常显示。
// 上游版本升级后 IElectronConfig 不再导出，typeof 推断无法命名（TS4023）；转发签名放宽。
const setConfig = (...args: unknown[]): void => {
  if (!desktopArmsTelemetryEnabled) return;
  Reflect.apply(armsRum.setConfig, armsRum, args);
};

const desktopArmsTelemetry = {
  setConfig,
  getConfig: (): { env?: string } | undefined =>
    desktopArmsTelemetryEnabled ? (armsRum.getConfig() as { env?: string }) : undefined,
  sendCustom: (...args: Parameters<typeof armsRum.sendCustom>): void => {
    if (!desktopArmsTelemetryEnabled) return;
    armsRum.sendCustom(...args);
  },
  sendEvent: (...args: Parameters<typeof armsRum.sendEvent>): void => {
    if (!desktopArmsTelemetryEnabled) return;
    armsRum.sendEvent(...args);
  },
};

export default desktopArmsTelemetry;
