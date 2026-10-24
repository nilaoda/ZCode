import {
  collectTelemetryRendererContext,
  resolveWorkspaceTelemetryDetail,
  type RendererTelemetryEventPayload,
} from "@zcode/shared";
// 设置页插件管理薄服务实现——plugins/* 旧协议词的唯一 host 侧消费点。
// 插件安装/市场/启停的事实源在 zcode-cli 进程（读写 ~/.zcode 插件目录并热更新
// 运行态），host 无副本，故实现保持 agent 协议往返；收敛价值在 UI 层不再直触
// IZCodeAgentService，词表消费面从 UI 散点收拢到本文件一处。
// 视觉助手的零候选关闭规则在此观察模型投影，再沿同一插件命令写入，不保存配置副本。
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IPluginManagementService } from "./pluginManagement.js";
import { Emitter } from "@zcode/rpc";
import { listVisionModelCandidates, type ModelSelectionView } from "@zcode/provider";
import { VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

export interface PluginManagementServiceDependencies {
  modelSelectionService: IModelSelectionService;
  reportTelemetryEvent?: (event: RendererTelemetryEventPayload) => void | Promise<void>;
  now?: () => number;
  zcodeAgentService: Pick<
    IZCodeAgentService,
    | "listPlugins"
    | "getPluginReferenceCatalog"
    | "resolveSuggestedPluginReference"
    | "onDynamicPluginOperationProgress"
    | "getPluginsOverview"
    | "addPluginMarketplace"
    | "removePluginMarketplace"
    | "updatePluginMarketplace"
    | "installPlugin"
    | "cancelPluginOperation"
    | "uninstallPlugin"
    | "updatePlugin"
    | "restoreBuiltinPlugin"
    | "configurePlugin"
    | "resetPluginConfig"
    | "validatePlugin"
    | "describePlugin"
    | "setPluginEnabled"
  >;
}

export function createPluginManagementService(
  dependencies: PluginManagementServiceDependencies,
): IPluginManagementService & { disposeAll(): void } {
  const agent = dependencies.zcodeAgentService;
  const models = dependencies.modelSelectionService;
  const changed = new Emitter<void>();
  const logger = createServiceLogger("vision-assistant");
  let disposed = false;
  let latestView: ModelSelectionView | undefined;
  let reconciliation = Promise.resolve();
  let writes = Promise.resolve();
  const service: IPluginManagementService & { disposeAll(): void } = {
    onDidChange: changed.event,
  const now = dependencies.now ?? Date.now;
  type Params =
    import("../zcode-agent/zcodeAgentPluginParams.js").ZCodeAgentPluginMutationTarget & {
      pluginId?: string;
      pluginName?: string;
      marketplace?: string;
      scope?: "user" | "workspace";
      dryRun?: boolean;
      removeCache?: boolean;
    };
  type Result = {
    diagnostics?: Array<{ severity?: string; code?: string }>;
    installedPlugins?: Array<{
      id: string;
      marketplace: string;
      version?: string;
      scope: string;
      listing?: { publisherType?: string };
    }>;
    removedPlugin?: { id: string; marketplace: string; version?: string };
    pluginId?: string;
    marketplaces?: unknown[];
    marketplace?: { id: string };
    plugin?: { id: string; marketplace: string; source: string; version?: string };
  };
  const report = (
    action: string,
    params: Params,
    startedAt: number,
    result?: Result,
    error?: unknown,
  ) => {
    if (params.dryRun || !dependencies.reportTelemetryEvent) return;
    const diagnostics = result?.diagnostics ?? [];
    const hasError = diagnostics.some((item) => item.severity === "error");
    // JSON-RPC 保留原始异常类型在 data.name；不能用取消请求的 ACK 或错误文案推断。
    const errorData =
      error instanceof Error && "data" in error && error.data && typeof error.data === "object"
        ? (error.data as { name?: unknown; code?: unknown })
        : undefined;
    const cancelled =
      errorData?.name === "AbortError" ||
      errorData?.code === "plugin_operation_cancelled" ||
      (error instanceof Error &&
        (error.name === "AbortError" ||
          ("code" in error && error.code === "plugin_operation_cancelled"))) ||
      diagnostics.some((item) => item.code === "plugin_operation_cancelled");
    const pluginId =
      params.pluginId ??
      (params.pluginName && params.marketplace
        ? `${params.pluginName}@${params.marketplace}`
        : result?.pluginId);
    const installed = result?.installedPlugins?.find((item) => item.id === pluginId);
    const status = cancelled
      ? "cancelled"
      : error
        ? "failure"
        : hasError
          ? action === "update" && !params.pluginId && result?.installedPlugins?.length
            ? "partial"
            : "failure"
          : action === "uninstall" && !result?.removedPlugin
            ? "noop"
            : action === "install" && !installed
              ? "failure"
              : action === "update" && !result?.installedPlugins?.length
                ? "noop"
                : "success";
    const detail: Record<string, string> = {
      schema_version: "1",
      action,
      result: status,
      duration_ms: String(Math.max(0, now() - startedAt)),
      entry: params.telemetry?.entry ?? "unknown",
      trigger: params.telemetry?.trigger ?? "user",
      client_kind: params.telemetry?.client_kind ?? "unknown",
      scope: params.scope ?? installed?.scope ?? "unknown",
      ...resolveWorkspaceTelemetryDetail(params),
      ...(pluginId || result?.removedPlugin
        ? { plugin_id: pluginId ?? result!.removedPlugin!.id }
        : {}),
      ...(params.marketplace || installed || result?.removedPlugin || result?.marketplace
        ? {
            marketplace:
              params.marketplace ??
              installed?.marketplace ??
              result?.removedPlugin?.marketplace ??
              result!.marketplace!.id,
          }
        : {}),
      ...(installed?.version ? { version_after: installed.version } : {}),
      ...(result?.removedPlugin?.version ? { version_before: result.removedPlugin.version } : {}),
      ...(installed?.listing?.publisherType
        ? { publisher_type: installed.listing.publisherType }
        : {}),
      ...(action === "uninstall" ? { remove_cache: String(params.removeCache ?? true) } : {}),
      ...(status === "failure" || status === "partial" || status === "cancelled"
        ? { error_category: cancelled ? "cancelled" : hasError ? "diagnostic" : "transport" }
        : {}),
    };
    // 上报只观察最终结果，不等待网络，失败不得改变原业务返回或触发业务重试。
    try {
      void Promise.resolve(
        dependencies.reportTelemetryEvent({
          elementName: "plugin_lifecycle",
          eventRegion: "app",
          eventType: "result",
          context: collectTelemetryRendererContext(),
          eventExtraDetail: detail,
        }),
      ).catch(() => {});
    } catch {
      /* 观测端故障与业务隔离。 */
    }
  };
  const observeMutation = async <T extends Result>(
    action: string,
    params: Params,
    invoke: (clean: Params) => Promise<T>,
  ): Promise<T> => {
    const startedAt = now();
    const { telemetry: _telemetry, ...clean } = params;
    try {
      const result = await invoke(clean);
      report(action, params, startedAt, result);
      return result;
    } catch (error) {
      report(action, params, startedAt, undefined, error);
      throw error;
    }
  };
      listPlugins: (params) => agent.listPlugins(params),
    getPluginReferenceCatalog: (params) => agent.getPluginReferenceCatalog(params),
    resolveSuggestedPluginReference: (params) => agent.resolveSuggestedPluginReference(params),
    onDynamicPluginOperationProgress: (operationId) =>
      agent.onDynamicPluginOperationProgress(operationId),
    getPluginsOverview: (params) => agent.getPluginsOverview(params),
    addPluginMarketplace: (params) =>
      observeMutation("source_add", params, (clean) => agent.addPluginMarketplace(clean as typeof params)),
    removePluginMarketplace: (params) =>
      observeMutation("source_remove", params, (clean) =>
        agent.removePluginMarketplace(clean as typeof params),
      ),
    updatePluginMarketplace: (params) =>
      observeMutation("source_refresh", params, (clean) =>
        agent.updatePluginMarketplace(clean as typeof params),
      ),
    installPlugin: (params) =>
      observeMutation("install", params, (clean) => agent.installPlugin(clean as typeof params)),
    cancelPluginOperation: (params) => agent.cancelPluginOperation(params),
    uninstallPlugin: (params) =>
      observeMutation("uninstall", params, (clean) => agent.uninstallPlugin(clean as typeof params)),
    updatePlugin: (params) =>
      observeMutation("update", params, (clean) => agent.updatePlugin(clean as typeof params)),
    restoreBuiltinPlugin: (params) =>
      observeMutation("restore", params, (clean) => agent.restoreBuiltinPlugin(clean as typeof params)),
    configurePlugin: (params) =>
      observeMutation("configure", params, (clean) => agent.configurePlugin(clean as typeof params)),
    resetPluginConfig: (params) =>
      observeMutation("reset_config", params, (clean) => agent.resetPluginConfig(clean as typeof params)),
    validatePlugin: (params) => agent.validatePlugin(params),
    describePlugin: (params) => agent.describePlugin(params),
    setPluginEnabled(params) {
      const operation = writes.then(async () => {
        if (disposed) throw new Error("Plugin management service is disposed");
        if (params.pluginId === VISION_ASSISTANT_PLUGIN_ID && params.enabled) {
          const read = await models.getView();
          if (disposed) throw new Error("Plugin management service is disposed");
          const view = latestView && latestView.revision > read.revision ? latestView : read;
          if (listVisionModelCandidates(view).length === 0)
            throw new Error("No configured vision model is available");
        }
        // 视觉助手门禁失败不进入插件生命周期上报；遥测只观察 agent 往返结果。
        return observeMutation(params.enabled ? "enable" : "disable", params, (clean) =>
          agent.setPluginEnabled(clean as typeof params),
        ).then((result) => {
          if (!disposed) changed.fire();
          return result;
        });
      });
      writes = operation.then(
        () => {},
        () => {},
      );
      return operation;
    },
    disposeAll() {
      disposed = true;
      subscription.dispose();
      changed.dispose();
    },
  };

  const observe = (view: ModelSelectionView) => {
    if (disposed || (latestView && view.revision < latestView.revision)) return;
    latestView = view;
    // 无候选必须在 Host 持久化关闭，不能依赖设置页是否挂载；读取失败不是零候选。
    // 串行且只接受当前 revision 的读取，避免过期删除事件覆盖后来新增的模型。
    reconciliation = reconciliation
      .then(async () => {
        // 模型删除可发生在启用 RPC 途中；先等已接纳的配置写入，避免读到旧的关闭状态而漏关。
        await writes;
        if (disposed || latestView !== view || listVisionModelCandidates(view).length > 0) return;
        const result = await agent.listPlugins({ configScope: "user" });
        if (disposed || latestView !== view) return;
        const plugin = result.plugins.find((item) => item.id === VISION_ASSISTANT_PLUGIN_ID);
        if (plugin?.enabled)
          await service.setPluginEnabled({
            pluginId: VISION_ASSISTANT_PLUGIN_ID,
            enabled: false,
            scope: "user",
          });
      })
      .catch((error: unknown) => {
        if (!disposed) logger.warn(undefined, "视觉助手自动关闭失败", error);
      });
  };
  const subscription = models.onDidChange(observe);
  void models.getView().then(observe, (error: unknown) => {
    if (!disposed) logger.warn(undefined, "视觉模型候选初始化失败，保留现有启用状态", error);
  });
  return service;
}
