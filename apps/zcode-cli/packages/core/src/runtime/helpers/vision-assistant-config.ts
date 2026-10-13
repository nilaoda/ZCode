import { VISION_ASSISTANT_AGENT_NAME } from "@zcode/shared";
import type { AgentProfile } from "../../subagent/profile.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { registerBuiltInTools } from "../deps.js";
import {
  resolveBuiltInToolAllowlist,
  resolveRuntimeDisallowedTools,
  resolveRuntimeDynamicWorkflowToolsIncluded,
} from "./tool-allowlist.js";
import { resolveRuntimeEmbeddedSearchEnabled } from "../methods/embedded-search-branch.js";

/** 上游 Agent 定义按轮加载；仅投影视觉配置，保留其它动态 Agent 和正在运行的快照。 */
export function applyVisionAssistantProfiles(
  active: readonly AgentProfile[],
  configured: readonly AgentProfile[],
): readonly AgentProfile[] {
  const vision = configured.filter((profile) => profile.name === VISION_ASSISTANT_AGENT_NAME);
  const previousPath = active.find((profile) => profile.name === VISION_ASSISTANT_AGENT_NAME)?.path;
  const profiles = active.filter((profile) =>
    profile.name !== VISION_ASSISTANT_AGENT_NAME &&
    !(previousPath && profile.name === "vision-reader" && profile.path === previousPath),
  );
  profiles.push(...vision);
  const alias = configured.find((profile) => profile.name === "vision-reader" &&
    vision.some((reader) => reader.path === profile.path));
  if (alias && !profiles.some((profile) => profile.name === "vision-reader")) profiles.push(alias);
  return profiles;
}

export async function refreshVisionAssistantConfig(runtime: AgentRuntimeInternal): Promise<void> {
  if (!runtime.visionAssistantConfigPort) return;
  const snapshot = await runtime.visionAssistantConfigPort.read();
  const previous = runtime.config.subagents?.profiles ?? [];
  const previousPath = previous.find(
    (profile) => profile.name === VISION_ASSISTANT_AGENT_NAME,
  )?.path;
  // 只替换视觉 profile 及其旧插件别名，不能删除用户自己定义的同名 bare profile。
  const profiles = previous.filter(
    (profile) =>
      profile.name !== VISION_ASSISTANT_AGENT_NAME &&
      !(previousPath && profile.name === "vision-reader" && profile.path === previousPath),
  );
  if (snapshot.enabled && snapshot.profile) {
    profiles.push(snapshot.profile);
    if (snapshot.profile.path && !profiles.some((profile) => profile.name === "vision-reader")) {
      profiles.push({ ...snapshot.profile, name: "vision-reader" });
    }
  }
  runtime.config.subagents = { ...runtime.config.subagents, profiles };
  runtime.config.runtimeFeatures = {
    ...runtime.config.runtimeFeatures,
    visionAssistant: snapshot.enabled,
  };
  runtime.registry.unregister("InspectImage");
  const allowlist = resolveBuiltInToolAllowlist(runtime.config);
  const tools = ["Agent", "Task"].filter((name) => runtime.registry.has(name));
  if (
    snapshot.enabled &&
    snapshot.profile &&
    runtime.subagentPort &&
    runtime.config.taskType !== "subagent_child" &&
    (allowlist === undefined || allowlist.includes("InspectImage"))
  ) {
    tools.push("InspectImage");
  }
  registerBuiltInTools(runtime.registry, {
    includeAgent: Boolean(runtime.subagentPort),
    includeInspectImage: tools.includes("InspectImage"),
    allowedTools: tools,
    disallowedTools: resolveRuntimeDisallowedTools(runtime.config),
    embeddedSearchEnabled: resolveRuntimeEmbeddedSearchEnabled(runtime),
    includeDynamicWorkflow: resolveRuntimeDynamicWorkflowToolsIncluded(runtime),
    silentDuplicateWarnings: true,
  });
  runtime.cachedTools = null;
}
