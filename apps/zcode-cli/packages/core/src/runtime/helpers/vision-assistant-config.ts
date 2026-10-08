import { VISION_ASSISTANT_AGENT_NAME } from "@zcode/shared";
import type { AgentRuntimeInternal } from "../internal.js";
import { registerBuiltInTools } from "../deps.js";
import {
  resolveBuiltInToolAllowlist,
  resolveRuntimeDisallowedTools,
  resolveRuntimeDynamicWorkflowToolsIncluded,
} from "./tool-allowlist.js";
import { resolveRuntimeEmbeddedSearchEnabled } from "../methods/embedded-search-branch.js";

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
    agentProfiles: profiles,
    embeddedSearchEnabled: resolveRuntimeEmbeddedSearchEnabled(runtime),
    includeDynamicWorkflow: resolveRuntimeDynamicWorkflowToolsIncluded(runtime.config),
    silentDuplicateWarnings: true,
  });
  runtime.cachedTools = null;
}
