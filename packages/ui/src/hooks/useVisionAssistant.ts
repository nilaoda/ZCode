import { useCallback, useEffect, useState } from "react";
import {
  createPluginAgentStateId,
  VISION_ASSISTANT_PLUGIN_ID,
  type ModelSelection,
} from "@zcode/shared";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";

export interface VisionAssistantTarget {
  workspacePath: string;
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
  const rpcReady = target.localOnly ? Boolean(target.workspacePath) : resolution.rpcReady;
  const { pluginManagementService, subagentsService, modelSelectionService } = services;
  const scope = target.configScope ?? "user";
  const identity = target.workspaceIdentity?.trim() || null;
  const plugin = usePluginManagementStore((state) =>
    state.workspacePath === target.workspacePath &&
    state.workspaceIdentity === identity &&
    state.configScope === scope
      ? state.plugins.find((item) => item.id === VISION_ASSISTANT_PLUGIN_ID)
      : undefined,
  );
  const initialize = usePluginManagementStore((state) => state.initialize);
  const owner = `${target.workspaceIdentity?.trim() || target.workspacePath}\0${scope}`;
  const [saved, setSaved] = useState<{
    owner: string;
    service: typeof subagentsService;
    selection?: ModelSelection;
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const models = useModelSelectionServiceView(modelSelectionService, rpcReady);

  useEffect(() => {
    if (!target.workspacePath || !rpcReady) return;
    void initialize({
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      configScope: scope,
      pluginService: pluginManagementService,
    });
  }, [
    initialize,
    pluginManagementService,
    rpcReady,
    scope,
    target.workspacePath,
    target.workspaceIdentity,
  ]);

  useEffect(() => {
    let active = true;
    setError(undefined);
    if (!target.workspacePath || !rpcReady) return;
    void subagentsService
      .getPluginAgentModelOverride({
        agentId: createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader"),
      })
      .then(
        (result) => {
          if (active)
            setSaved({
              owner,
              service: subagentsService,
              selection: result.modelSelection,
            });
        },
        (cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    return () => {
      active = false;
    };
  }, [
    owner,
    subagentsService,
    rpcReady,
    target.workspacePath,
    target.workspaceIdentity,
    plugin?.enabled,
  ]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setPending(true);
      setError(undefined);
      try {
        const success = await usePluginManagementStore
          .getState()
          .setEnabled(VISION_ASSISTANT_PLUGIN_ID, enabled, pluginManagementService, scope);
        if (!success)
          setError(
            usePluginManagementStore.getState().error ?? "Unable to update vision assistant",
          );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(false);
      }
    },
    [pluginManagementService, scope],
  );

  const setModel = useCallback(
    async (selection?: ModelSelection) => {
      setPending(true);
      setError(undefined);
      try {
        await subagentsService.setPluginAgentModelOverride({
          agentId: createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader"),
          modelSelection: selection,
        });
        setSaved({ owner, service: subagentsService, selection });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(false);
      }
    },
    [owner, subagentsService],
  );

  return {
    plugin,
    pending,
    error,
    setEnabled,
    setModel,
    models,
    ready: saved?.owner === owner && saved.service === subagentsService,
    selection:
      saved?.owner === owner && saved.service === subagentsService ? saved.selection : undefined,
  };
}
