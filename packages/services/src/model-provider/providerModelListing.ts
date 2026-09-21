import type { ProviderApiType } from "@zcode/provider";

/**
 * 通过供应商的 `/models` 接口拉取其可用模型列表。
 *
 * 三种 API 格式都支持，且都能用同一套归一化逻辑：
 *   - `openai-chat-completions` / `openai-responses`：`GET <baseUrl>/models`，
 *     `Authorization: Bearer <key>`；响应 `{ data: [{ id, ... }] }`。
 *     `/models` 与聊天协议无关 —— 它是独立的 REST 端点，两种 OpenAI 系协议共用。
 *   - `anthropic-messages`：`GET <baseUrl>/models`，`x-api-key: <key>` +
 *     `anthropic-version: 2023-06-01`；响应同样是 `{ data: [{ id, ... }] }`。
 *     https://platform.claude.com/docs/en/api/models/list
 *
 * 因此归一化只需读 `data[].id`。
 */

/** `/models` 的请求超时。列表接口应快速返回；超时过长会让设置页看起来卡住。 */
const MODELS_REQUEST_TIMEOUT_MS = 15_000;

/** Anthropic 要求显式声明 API 版本。 */
const ANTHROPIC_VERSION = "2023-06-01";

export interface ProviderModelsRequestInput {
  readonly apiFormat: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  /** 供应商配置里自定义的 headers，优先于默认鉴权头。 */
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export type ProviderModelsResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | {
      readonly ok: false;
      readonly error: {
        readonly message: string;
        readonly code?: "missing-base-url" | "unsupported-format" | "http-error" | "bad-response";
      };
    };

/** 拼接 `<baseUrl>/models`，容忍 baseUrl 结尾多余的 `/`。 */
export function buildModelsEndpointUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/u, "")}/models`;
}

/**
 * 按 API 格式构造鉴权头。
 *
 * 显式配置的 headers 优先 —— 有些自建网关用非标准头（如自定义 token 头），
 * 不应该被默认的 `Authorization` 覆盖掉。
 */
export function buildModelsRequestHeaders(input: {
  apiFormat: ProviderApiType;
  apiKey?: string;
  headers?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = input.apiKey?.trim();

  if (input.apiFormat === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    if (apiKey) headers["x-api-key"] = apiKey;
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  for (const [key, value] of Object.entries(input.headers ?? {})) {
    const name = key.trim();
    if (name) headers[name.toLowerCase()] = value;
  }
  return headers;
}

/**
 * 从响应体里提取模型 ID 列表。
 *
 * 兼容两种常见形状：OpenAI / Anthropic 的 `{ data: [{ id }] }`，以及少数网关
 * 直接返回数组。过滤掉非字符串与空值，并保持服务端返回的顺序去重。
 */
export function extractModelIds(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return [];

  const seen = new Set<string>();
  for (const row of rows) {
    const id =
      typeof row === "string"
        ? row
        : typeof row === "object" && row !== null && typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id
          : undefined;
    const trimmed = id?.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** 请求 `<baseUrl>/models` 并返回归一化后的模型 ID 列表。 */
export async function fetchProviderModels(
  input: ProviderModelsRequestInput,
): Promise<ProviderModelsResult> {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    return { ok: false, error: { message: "供应商未配置 Base URL", code: "missing-base-url" } };
  }

  const timeoutSignal = AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch(buildModelsEndpointUrl(baseUrl), {
      method: "GET",
      headers: buildModelsRequestHeaders(input),
      signal,
    });
    if (!response.ok) {
      // 带上状态码，用户能区分「路径不对（404）」与「鉴权失败（401/403）」。
      return {
        ok: false,
        error: {
          message: `请求 ${buildModelsEndpointUrl(baseUrl)} 返回 HTTP ${response.status}`,
          code: "http-error",
        },
      };
    }
    const models = extractModelIds(await response.json());
    if (models.length === 0) {
      return {
        ok: false,
        error: {
          message: "接口未返回任何模型；请确认 Base URL 指向兼容 OpenAI / Anthropic 的服务",
          code: "bad-response",
        },
      };
    }
    return { ok: true, models };
  } catch (error) {
    // 超时、DNS、连接被拒都会走到这里；保留原始消息便于用户排查地址与网络。
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        message: timeoutSignal.aborted ? `请求超时（${MODELS_REQUEST_TIMEOUT_MS / 1000}s）` : message,
        code: "http-error",
      },
    };
  }
}
