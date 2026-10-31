import type { ModelConnectivityResult, ModelSpeedTestMetrics } from "@zcode/shared";
import type { ProviderSettingsConnectivityTester } from "./providerFacadeServices.js";

interface FormalModelConnectivityInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly selection: {
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly mode?: "connectivity" | "speed";
}

type FormalModelConnectivityExecutor = (
  input: FormalModelConnectivityInput,
) => Promise<{ readonly success: true; readonly metrics?: ModelSpeedTestMetrics }>;

/**
 * 设置页只负责把已经落盘并进入 Registry 的 ModelSelection 交给目标 Environment。
 * Provider 鉴权、headers、reasoning 映射和流消费全部由正式 Model 执行链负责。
 */
export function createProviderSettingsConnectivityTester(dependencies: {
  readonly testModelConnectivity: FormalModelConnectivityExecutor;
}): ProviderSettingsConnectivityTester {
  return async (input) => {
    try {
      const probe = await dependencies.testModelConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        selection: {
          providerId: input.providerId,
          modelId: input.modelId,
        },
        ...(input.mode ? { mode: input.mode } : {}),
      });
      return { success: true, ...(probe.metrics ? { metrics: probe.metrics } : {}) };
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
}

export type { ModelConnectivityResult };
