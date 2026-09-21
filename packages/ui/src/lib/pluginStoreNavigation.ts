import { ZCODE_LOCAL_ONLY_BUILD } from "@zcode/shared";

const OPEN_PLUGIN_STORE_EVENT = "zcode:open-plugin-store";
export interface PluginStoreOpenTarget {
  pluginId?: string;
  intent?: "add-marketplace";
  returnScopeKey?: string;
}

let pendingTarget: PluginStoreOpenTarget | null = null;

/** 统一承载 Store 入口的目标插件与 Settings 返回位置。Marketplace 只允许返回 User 视图。 */
export function requestPluginStoreOpen(value?: string | PluginStoreOpenTarget): void {
  // 本地化发行版：插件市场的内容来自远端 marketplace（联网），整条入口直接关闭。
  // 在导航函数层拦截即可覆盖全部调用点（设置页插件分区、工作区插件预览等），
  // 也不会再向 WorkspaceShellLayout 派发打开事件。
  if (ZCODE_LOCAL_ONLY_BUILD) return;
  const normalized = typeof value === "string" ? value.trim() : undefined;
  pendingTarget =
    typeof value === "object"
      ? { ...value, ...(value.returnScopeKey ? { returnScopeKey: "user" } : {}) }
      : normalized
        ? normalized.includes("@")
          ? { pluginId: normalized }
          : { returnScopeKey: "user" }
        : {};
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PluginStoreOpenTarget>(OPEN_PLUGIN_STORE_EVENT, {
      detail: pendingTarget,
    }),
  );
}

export function consumePluginStoreOpenTarget(): PluginStoreOpenTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

export function addPluginStoreOpenListener(
  listener: (target: PluginStoreOpenTarget) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handleOpen = (event: Event) => {
    listener((event as CustomEvent<PluginStoreOpenTarget>).detail ?? {});
  };
  window.addEventListener(OPEN_PLUGIN_STORE_EVENT, handleOpen);
  return () => window.removeEventListener(OPEN_PLUGIN_STORE_EVENT, handleOpen);
}
