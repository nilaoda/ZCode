// 设置页插件管理服务——plugins/* 旧协议词的唯一 host 侧消费点。
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

interface PluginManagementServiceDependencies {
  modelSelectionService: IModelSelectionService;
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
    listPlugins: (params) => agent.listPlugins(params),
    getPluginReferenceCatalog: (params) => agent.getPluginReferenceCatalog(params),
    resolveSuggestedPluginReference: (params) => agent.resolveSuggestedPluginReference(params),
    onDynamicPluginOperationProgress: (operationId) =>
      agent.onDynamicPluginOperationProgress(operationId),
    getPluginsOverview: (params) => agent.getPluginsOverview(params),
    addPluginMarketplace: (params) => agent.addPluginMarketplace(params),
    removePluginMarketplace: (params) => agent.removePluginMarketplace(params),
    updatePluginMarketplace: (params) => agent.updatePluginMarketplace(params),
    installPlugin: (params) => agent.installPlugin(params),
    cancelPluginOperation: (params) => agent.cancelPluginOperation(params),
    uninstallPlugin: (params) => agent.uninstallPlugin(params),
    updatePlugin: (params) => agent.updatePlugin(params),
    restoreBuiltinPlugin: (params) => agent.restoreBuiltinPlugin(params),
    configurePlugin: (params) => agent.configurePlugin(params),
    resetPluginConfig: (params) => agent.resetPluginConfig(params),
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
        const result = await agent.setPluginEnabled(params);
        if (!disposed) changed.fire();
        return result;
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
