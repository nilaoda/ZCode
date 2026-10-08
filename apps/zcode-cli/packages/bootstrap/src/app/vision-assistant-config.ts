import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAgentProfileFromMarkdown, type AgentRuntimeDeps } from "@zcode/core";
import {
  createPluginAgentStateId,
  parsePluginSubagentModelSelectionOverrides,
  VISION_ASSISTANT_AGENT_NAME,
  VISION_ASSISTANT_PLUGIN_ID,
} from "@zcode/shared";
import { scanOfficialPluginCacheRoots } from "@zcode/shared/node";
import { DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS } from "./official-plugin-definitions.js";

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value)) throw new Error("Vision assistant configuration must be an object");
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createVisionAssistantConfigPort(input: {
  userConfigPath: string;
  storageRoot: string;
  pluginStorageRoot: string;
  officialPluginRoots: readonly string[];
  skipUserConfig?: boolean;
}): NonNullable<AgentRuntimeDeps["visionAssistantConfigPort"]> {
  return {
    async read() {
      // 旧会话的插件快照不会收到其它管理进程的写入；每轮从原有持久化事实源重读。
      const config = input.skipUserConfig ? {} : await readJson(input.userConfigPath);
      const plugins = isRecord(config.plugins) ? config.plugins : {};
      const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
      const enabled = enabledPlugins[VISION_ASSISTANT_PLUGIN_ID];
      if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new Error("Invalid vision assistant enabled setting");
      }
      if (
        plugins.enabled === false ||
        enabled === false ||
        (Array.isArray(plugins.suppressedBuiltins) &&
          plugins.suppressedBuiltins.includes(VISION_ASSISTANT_PLUGIN_ID)) ||
        (enabled === undefined &&
          !DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS.has(VISION_ASSISTANT_PLUGIN_ID))
      ) {
        return { enabled: false };
      }
      const cacheRoots = await scanOfficialPluginCacheRoots(input.pluginStorageRoot);
      const roots = [
        ...input.officialPluginRoots,
        ...(cacheRoots.find((entry) => entry.name === "vision-assistant")?.versionRoots ?? []),
      ];
      for (const root of new Set(roots)) {
        const manifest = await readJson(join(root, ".zcode-plugin", "plugin.json"));
        if (manifest.name !== "vision-assistant") continue;
        const path = join(root, "agents", "vision-reader.md");
        const parsed = parseAgentProfileFromMarkdown({
          content: await readFile(path, "utf8"),
          path,
          source: "user",
        });
        if (!parsed.profile) throw new Error("Vision assistant profile is invalid");
        const state = await readJson(join(input.storageRoot, "v2", "agents-state.json"));
        const overrides = parsePluginSubagentModelSelectionOverrides(
          state.pluginAgentModelSelectionOverrides,
        );
        const selection =
          overrides[createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader")];
        return {
          enabled: true,
          profile: {
            ...parsed.profile,
            name: VISION_ASSISTANT_AGENT_NAME,
            ...(selection ? { modelSelection: selection } : {}),
          },
        };
      }
      return { enabled: false };
    },
  };
}
