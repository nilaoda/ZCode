import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createPluginAgentStateId,
  VISION_ASSISTANT_PLUGIN_ID,
  type ModelSelection,
  type ZCodePluginInfo,
} from "@zcode/shared";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { listVisionModelCandidates } from "@zcode/provider";

export interface VisionAssistantTarget {
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  configScope?: "user" | "workspace";
  localOnly?: boolean;
}

export function useVisionAssistant(target: VisionAssistantTarget) {
  const resolution = useWorkspaceServicesResolution(
    target.workspacePath,
    target.remoteSessionId,
    target.workspaceIdentity,
    target.remoteTarget,
  );
  const baseServices = useBaseWorkspaceServices();
  const services = target.localOnly ? baseServices : resolution.services;
  // 全局设置曾误用模型连通性测试的 cwd 判断就绪；配置读取本身不需要项目。
  const rpcReady = target.localOnly || Boolean(target.workspacePath && resolution.rpcReady);
  const { pluginManagementService, subagentsService, modelSelectionService } = services;
  const scope = target.localOnly ? "user" : (target.configScope ?? "user");
  const workspacePath = target.localOnly ? undefined : target.workspacePath;
  const workspaceIdentity = target.localOnly ? undefined : target.workspaceIdentity;
  const remoteSessionId = target.localOnly ? undefined : target.remoteSessionId;
  const owner = target.localOnly
    ? "local-user"
    : `${workspaceIdentity?.trim() || workspacePath}\0${scope}\0${remoteSessionId ?? ""}`;
  const binding = useMemo(() => ({ services, owner, rpcReady }), [services, owner, rpcReady]);
  const currentBinding = useRef(binding);
  currentBinding.current = binding;
  const generation = useRef(0);
  const mutation = useRef<typeof binding | undefined>(undefined);
  const [reloadVersion, reload] = useReducer((value: number) => value + 1, 0);
  const [saved, setSaved] = useState<{
    binding: typeof binding;
    plugin?: ZCodePluginInfo;
    selection?: ModelSelection;
    loading: boolean;
    pending: boolean;
    error?: string;
  }>();
  const models = useModelSelectionServiceView(modelSelectionService, rpcReady);
  const visible = saved?.binding === binding ? saved : undefined;

  useEffect(() => {
    if (!rpcReady) return;
    const subscription = pluginManagementService.onDidChange(() => reload());
    return () => subscription.dispose();
  }, [pluginManagementService, rpcReady]);

  useEffect(() => {
    const request = ++generation.current;
    setSaved({ binding, loading: true, pending: mutation.current === binding });
    if (!rpcReady) return;
    // 这里只保留 Service 的读取投影；插件状态与模型覆盖仍由原有用户配置文件持有。
    void Promise.all([
      pluginManagementService.listPlugins(
        workspacePath
          ? { workspacePath, workspaceIdentity, remoteSessionId, configScope: scope }
          : { configScope: "user" },
      ),
      subagentsService.getPluginAgentModelOverride({
        agentId: createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader"),
      }),
    ]).then(
      ([plugins, result]) => {
        if (generation.current !== request || currentBinding.current !== binding) return;
        setSaved({
          binding,
          plugin: plugins.plugins.find((item) => item.id === VISION_ASSISTANT_PLUGIN_ID),
          selection: result.modelSelection,
          loading: false,
          pending: mutation.current === binding,
        });
      },
      (cause: unknown) => {
        if (generation.current !== request || currentBinding.current !== binding) return;
        setSaved({
          binding,
          loading: false,
          pending: mutation.current === binding,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [
    binding,
    pluginManagementService,
    subagentsService,
    rpcReady,
    reloadVersion,
    scope,
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
  ]);

  const update = useCallback(
    async (operation: () => Promise<{ plugin?: ZCodePluginInfo; selection?: ModelSelection }>) => {
      if (!rpcReady || mutation.current === binding) return;
      mutation.current = binding;
      const isCurrent = () => currentBinding.current === binding;
      setSaved((current) =>
        current?.binding === binding ? { ...current, pending: true, error: undefined } : current,
      );
      try {
        const result = await operation();
        if (isCurrent()) {
          // 插件变化可能在保存模型途中触发重读；写入成功后再读权威配置，不能丢掉成功结果。
          generation.current += 1;
          setSaved((current) =>
            current?.binding === binding ? { ...current, ...result, pending: false } : current,
          );
          reload();
        }
      } catch (cause) {
        if (isCurrent())
          setSaved((current) =>
            current?.binding === binding
              ? {
                  ...current,
                  pending: false,
                  error: cause instanceof Error ? cause.message : String(cause),
                }
              : current,
          );
      } finally {
        if (mutation.current === binding) mutation.current = undefined;
      }
    },
    [binding, rpcReady],
  );

  const setEnabled = useCallback(
    (enabled: boolean) =>
      update(async () => {
        const result = await pluginManagementService.setPluginEnabled({
          ...(workspacePath
            ? { workspacePath, workspaceIdentity, remoteSessionId, scope }
            : { scope: "user" as const }),
          pluginId: VISION_ASSISTANT_PLUGIN_ID,
          enabled,
        });
        return { plugin: { ...result.plugin, enabled: result.enabled } };
      }),
    [update, pluginManagementService, workspacePath, workspaceIdentity, remoteSessionId, scope],
  );
  const setModel = useCallback(
    (selection?: ModelSelection) =>
      update(async () => {
        await subagentsService.setPluginAgentModelOverride({
          agentId: createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader"),
          modelSelection: selection,
        });
        return { selection };
      }),
    [update, subagentsService],
  );

  return {
    plugin: visible?.plugin,
    pending: visible?.pending ?? false,
    loading: rpcReady && (!visible || visible.loading),
    unavailableReason: rpcReady ? undefined : workspacePath ? "remote-waiting" : "missing-target",
    error:
      visible?.error ?? (models.state.status === "error" ? models.state.error.message : undefined),
    setEnabled,
    setModel,
    models,
    hasCandidates:
      models.state.status === "ready" && listVisionModelCandidates(models.state.view).length > 0,
    ready: Boolean(rpcReady && visible && !visible.loading),
    selection: visible?.selection,
    reload: () => {
      models.reload();
      reload();
    },
  };
}
