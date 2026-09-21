import { buildOfficialPluginMarketplaceUrl } from "./pluginCdn.js";

export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "zcode-plugins-official";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@zcode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@zcode-plugins-official",
  // 该集合必须与 apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts
  // 里标了 defaultEnabled 的插件逐一对应。本仓库是上游的不完整开源发行版，
  // image-search / documents / pdf / presentations / spreadsheets / skill-creator /
  // plugin-creator / zcode-guide 的插件包未随仓库分发，对应定义已裁剪，此处同步收窄。
  // 恢复上游插件包时，需同时恢复 definition 与本名单。
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // ZCode 官方唯一市场：本地 seed 分片与 CDN 分片在 Agent storage 内合并。
    // CDN manifest 的 name 必须与该 canonical id 一致。
    // 目录地址由 ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL 派生，内网部署可指向自建镜像；
    // 未配置时仍为线上 CDN。
    id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: buildOfficialPluginMarketplaceUrl(),
    name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official ZCode plugins marketplace: built-in and community plugins for ZCode.",
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个 ZCode 官方市场 id，内置与 CDN 不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
