import { createContext, useContext } from "react";
import type { ReactNode } from "react";
// 退役功能默认关闭，避免上游新增 Provider 默认值重新显示入口并订阅任务。
const DEFAULT_WEB_REMOTE_CONTROL_FEATURE_ENABLED = false;

const WebRemoteControlFeatureContext = createContext(DEFAULT_WEB_REMOTE_CONTROL_FEATURE_ENABLED);

export function WebRemoteControlFeatureProvider({
  enabled = DEFAULT_WEB_REMOTE_CONTROL_FEATURE_ENABLED,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  return (
    <WebRemoteControlFeatureContext.Provider value={enabled}>
      {children}
    </WebRemoteControlFeatureContext.Provider>
  );
}

export function useWebRemoteControlFeatureEnabled(): boolean {
  return useContext(WebRemoteControlFeatureContext);
}
