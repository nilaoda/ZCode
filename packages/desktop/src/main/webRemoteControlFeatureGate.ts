export interface WebRemoteControlFeatureGate {
  isEnabled(): boolean;
  assertEnabled(): void;
}

export function createWebRemoteControlFeatureGate(
  // 未显式启用时关闭，避免新增装配点意外恢复已退役的 relay。
  enabled = false,
): WebRemoteControlFeatureGate {
  return {
    isEnabled: () => enabled,
    assertEnabled: () => {
      if (!enabled) {
        throw new Error("Web remote control is disabled in this build");
      }
    },
  };
}
