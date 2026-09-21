import { BlockList, isIP } from "node:net";

/**
 * WebFetch 内网目标放行策略。
 *
 * 背景：WebFetch 默认只允许公网目标 —— `webfetch-url` 的形态过滤与
 * `webfetch-egress-guard` 的每次 GET 复核都会拒绝本地/私网地址。内网部署下
 * 这一策略会让 Agent 无法读取内网文档、Wiki 或内部 API。
 *
 * 设计：
 * - **默认行为完全不变**：未配置 `ZCODE_WEBFETCH_ALLOW_PRIVATE_HOSTS` 时，
 *   所有私网/本地目标仍被拒绝。
 * - 内网部署通过该环境变量**显式声明**可信目标，命中后才放行。
 * - 命中放行的目标同时跳过 `http → https` 强制升级：内网服务通常只监听明文
 *   HTTP，强制升级会让放行形同虚设。该升级原本用于阻止对公网的明文出站，
 *   对已被显式信任的内网目标不适用。
 *
 * 唯一所有者：本模块是「WebFetch 是否允许访问该主机」的唯一判定入口。
 * `webfetch-url`（URL 形态过滤）与 `webfetch-egress-guard`（出站前复核）
 * 都必须调用 `isWebFetchPrivateTargetAllowed`，不得各自实现匹配逻辑。
 *
 * 语法（逗号分隔，忽略空白与空项）：
 * - `*`                 放行全部私网目标（等价于关闭该策略）
 * - `.intranet.corp`    后缀匹配，命中 `intranet.corp` 与 `*.intranet.corp`
 * - `*.intranet.corp`   同上，两种写法等价
 * - `git.intranet.corp` 精确匹配该主机名
 * - `10.0.0.0/8`        CIDR 匹配字面量 IP（IPv4/IPv6 均可）
 */

export const WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV = "ZCODE_WEBFETCH_ALLOW_PRIVATE_HOSTS";

const ALLOW_ALL_TOKEN = "*";
const CIDR_PATTERN = /^[0-9a-fA-F:.%]+\/\d{1,3}$/;

export interface WebFetchPrivateEgressAllowlist {
  /** 配置了 `*`，放行全部私网目标。 */
  readonly allowAll: boolean;
  /** 精确主机名。 */
  readonly exactHosts: ReadonlySet<string>;
  /** 后缀（不含前导点），用于 `.corp` / `*.corp` 形式。 */
  readonly hostSuffixes: readonly string[];
  /** 字面量 IP 的 CIDR 白名单；仅当存在 IP 段时非空。 */
  readonly ipBlockList: BlockList | null;
}

const EMPTY_ALLOWLIST: WebFetchPrivateEgressAllowlist = Object.freeze({
  allowAll: false,
  exactHosts: new Set<string>(),
  hostSuffixes: Object.freeze([]),
  ipBlockList: null,
});

function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return withoutBrackets.endsWith(".") ? withoutBrackets.slice(0, -1) : withoutBrackets;
}

export function parseWebFetchPrivateEgressAllowlist(
  raw: string | undefined,
): WebFetchPrivateEgressAllowlist {
  const tokens = (raw ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    return EMPTY_ALLOWLIST;
  }

  const exactHosts = new Set<string>();
  const hostSuffixes: string[] = [];
  let allowAll = false;
  let ipBlockList: BlockList | null = null;
  let ipRuleCount = 0;

  for (const token of tokens) {
    if (token === ALLOW_ALL_TOKEN) {
      allowAll = true;
      continue;
    }

    if (CIDR_PATTERN.test(token)) {
      const [rawAddress = "", prefixText = ""] = token.split("/");
      const address = normalizeHostname(rawAddress);
      const prefix = Number.parseInt(prefixText, 10);
      const family = isIP(address);
      if (family === 0 || !Number.isFinite(prefix)) {
        continue;
      }
      // 单个 BlockList 同时容纳 IPv4 与 IPv6 规则，check 时按 family 分派。
      const blockList = (ipBlockList ??= new BlockList());
      // 非法前缀长度由 BlockList 抛错；捕获后跳过该项，避免一条笔误让整个策略失效。
      try {
        blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
        ipRuleCount += 1;
      } catch {
        continue;
      }
      continue;
    }

    // `*.corp` 与 `.corp` 是同一种后缀语义；裸主机名才是精确匹配。
    if (token.startsWith("*.") || token.startsWith(".")) {
      const suffix = token.startsWith("*.") ? token.slice(2) : token.slice(1);
      if (suffix) {
        hostSuffixes.push(suffix);
      }
      continue;
    }

    if (token) {
      exactHosts.add(token);
    }
  }

  return Object.freeze({
    allowAll,
    exactHosts,
    hostSuffixes: Object.freeze(hostSuffixes),
    ipBlockList: ipRuleCount > 0 ? ipBlockList : null,
  });
}

// 环境变量在进程生命周期内不变；按原始字符串缓存，测试改写环境变量后能自然失效。
let cachedRaw: string | undefined;
let cachedAllowlist: WebFetchPrivateEgressAllowlist | undefined;

export function resolveWebFetchPrivateEgressAllowlist(
  raw: string | undefined = typeof process === "undefined"
    ? undefined
    : process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV],
): WebFetchPrivateEgressAllowlist {
  if (cachedAllowlist === undefined || cachedRaw !== raw) {
    cachedAllowlist = parseWebFetchPrivateEgressAllowlist(raw);
    cachedRaw = raw;
  }
  return cachedAllowlist;
}

function matchesHostSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * 判断某个主机名是否被显式放行访问私网地址。
 *
 * 返回 `true` 表示调用方应跳过私网拦截（以及 HTTP 明文升级）。
 */
export function isWebFetchPrivateTargetAllowed(hostname: string): boolean {
  const allowlist = resolveWebFetchPrivateEgressAllowlist();
  if (allowlist.allowAll) {
    return true;
  }

  const host = normalizeHostname(hostname);
  if (!host) {
    return false;
  }

  const ipFamily = isIP(host);
  if (ipFamily !== 0 && allowlist.ipBlockList) {
    return allowlist.ipBlockList.check(host, ipFamily === 4 ? "ipv4" : "ipv6");
  }

  if (allowlist.exactHosts.has(host)) {
    return true;
  }

  return allowlist.hostSuffixes.some((suffix) => matchesHostSuffix(host, suffix));
}
