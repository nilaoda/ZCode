import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = [
  "vision-assistant-plugin",
  "visualize-plugin",
  "documents-plugin",
  "pdf-plugin",
  "presentations-plugin",
  "spreadsheets-plugin",
  "browser-use-plugin",
  "restore-legacy-sessions-plugin",
  "skill-creator-plugin",
  "plugin-creator-plugin",
  "zcode-guide-plugin",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // 开发态远程插件复制使用独立白名单，遗漏 agents 会只在远端丢失子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  // Browser bootstrap 会从插件根目录动态导入 scripts/browser-client.mjs。
  // 开发态 SSH 部署若漏掉 scripts，会出现 MCP server 已启动但浏览器绑定无法初始化的半成品状态。
  "scripts",
  "skills",
  "templates",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = [
  "vision-assistant-plugin/.zcode-plugin/plugin.json",
  "vision-assistant-plugin/agents/vision-reader.md",
  "visualize-plugin/.zcode-plugin/plugin.json",
  "visualize-plugin/skills/visualize/SKILL.md",
  "visualize-plugin/skills/visualize/references/api.md",
  "visualize-plugin/skills/visualize/references/styles.md",
  "visualize-plugin/skills/visualize/tweak.md",
  "visualize-plugin/skills/visualize/LICENSE.md",
  "visualize-plugin/skills/visualize/scripts/render.py",
  "visualize-plugin/skills/visualize/assets/visualize.css",
  "visualize-plugin/skills/visualize/assets/visualize.html",
  "visualize-plugin/skills/visualize/assets/calendar.js",
  "visualize-plugin/skills/visualize/assets/runtime-manifest.json",
  "visualize-plugin/skills/visualize/scripts/vendor.py",
  "visualize-plugin/skills/visualize/assets/vendor/manifest.json",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/topojson-client-3.1.0.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/topojson-client-3.1.0.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/world-countries-110m-1.0.0.js",
  "visualize-plugin/skills/visualize/assets/vendor/world-countries-110m-1.0.0.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/us-counties-10m-3.0.1.js",
  "visualize-plugin/skills/visualize/assets/vendor/us-counties-10m-3.0.1.js.LICENSE",
  "visualize-plugin/skills/visualize/widgets/calendar.md",
  "visualize-plugin/skills/visualize/examples/calendar.html",
  "visualize-plugin/skills/visualize/assets/standalone-host-bridge.js",
  "visualize-plugin/skills/visualize/assets/standalone-shell.js",
  "documents-plugin/.zcode-plugin/plugin.json",
  "documents-plugin/agents/visual-judge.md",
  "documents-plugin/skills/docx/SKILL.md",
  "pdf-plugin/.zcode-plugin/plugin.json",
  "pdf-plugin/agents/visual-judge.md",
  "pdf-plugin/skills/pdf/SKILL.md",
  "presentations-plugin/.zcode-plugin/plugin.json",
  "presentations-plugin/agents/visual-judge.md",
  "presentations-plugin/skills/pptx/SKILL.md",
  "spreadsheets-plugin/.zcode-plugin/plugin.json",
  "spreadsheets-plugin/agents/visual-judge.md",
  "spreadsheets-plugin/skills/xlsx/SKILL.md",
  "browser-use-plugin/.zcode-plugin/plugin.json",
  "browser-use-plugin/scripts/browser-client.mjs",
  "browser-use-plugin/docs/api.json",
  "browser-use-plugin/docs/documents.json",
  "browser-use-plugin/docs/overview.md",
  "browser-use-plugin/docs/recording.md",
  "browser-use-plugin/docs/workflow.md",
  "browser-use-plugin/skills/control-browser/SKILL.md",
  "browser-use-plugin/skills/web-gui-tester/SKILL.md",
  "restore-legacy-sessions-plugin/.zcode-plugin/plugin.json",
  "skill-creator-plugin/.zcode-plugin/plugin.json",
  "plugin-creator-plugin/.zcode-plugin/plugin.json",
  "zcode-guide-plugin/.zcode-plugin/plugin.json",
  "zcode-guide-plugin/skills/zcode-configuration-guide/SKILL.md",
] as const;

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
