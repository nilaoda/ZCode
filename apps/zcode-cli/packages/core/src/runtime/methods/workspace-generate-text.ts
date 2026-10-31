import {
  SessionEventType,
  createChildTraceContext,
  runWithModelInvocationContext,
  traceContextToLogContext,
} from "../deps.js";
import type {
  ModelInputMessage,
  ModelSelection,
  ModelRequest,
  ModelToolCall,
  ModelToolContract,
  ModelUsage,
  SessionEvent,
  TraceContext,
} from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "./model-runtime-headers.js";
import { recordModelUsageFact } from "./usage-observability.js";
import { createRuntimeModel } from "./runtime-model.js";
import { normalizeStreamError } from "../helpers/index.js";
import { auxiliaryModelOptions } from "../../model/auxiliary-model-options.js";
import { INPUT_PREDICTION_QUERY_SOURCE } from "./input-prediction-sidecar.js";

const WORKSPACE_GENERATE_TEXT_TIMEOUT_MS = 60_000;
const CONNECTIVITY_PROBE_MAX_OUTPUT_TOKENS = 1;
// 探测请求使用固定最小 prompt，避免多余推理开销；不可改写角色、文本或混入会话历史。
const CONNECTIVITY_PROBE_SYSTEM = "You are ZCode connectivity probe.";
const CONNECTIVITY_PROBE_USER = "hi";
// 测速 probe：输出量决定解码窗口的稳定度；256 token 预算在常见模型上约 2-5s。
const SPEED_PROBE_MAX_OUTPUT_TOKENS = 256;
const SPEED_PROBE_TIMEOUT_MS = 30_000;
// 行数刻意高于 token 预算：probe 稳定以 finishReason=length 顶满预算结束，
// 解码工作量跨模型一致，窗口不受输出长度习惯影响。
const SPEED_PROBE_TARGET_LINES = 128;
// 随机词让生成内容随 seed 变化；decode 吞吐与内容熵无关，词表只为避免固定输出被
// 服务端整响应缓存。
const SPEED_PROBE_SEED_WORDS = [
  "harbor",
  "meadow",
  "compass",
  "lantern",
  "orchard",
  "cipher",
  "glacier",
  "mosaic",
  "thunder",
  "velvet",
  "zenith",
  "ripple",
] as const;
const GIT_COMMIT_MESSAGE_QUERY_SOURCE = "git_commit_message";
const PROVIDER_SETTINGS_SPEED_TEST_QUERY_SOURCE = "provider_settings_speed_test";

export interface ModelSpeedProbeMetrics {
  outputTokens: number;
  ttftMs: number;
  decodeMs: number;
  decodeTps: number;
}

export interface WorkspaceGenerateTextInput {
  selection: ModelSelection;
  prompt?: string;
  messages?: ModelInputMessage[];
  tools?: ModelToolContract[];
  querySource: string;
  maxOutputTokens?: number;
}

export interface WorkspaceGenerateTextResult {
  text: string;
  selection: ModelSelection;
  finishReason: string;
  usage?: ModelUsage;
  toolCalls?: ModelToolCall[];
}

export interface ModelConnectivityTestInput {
  selection: ModelSelection;
  /** speed：发足量 decode tokens 并回传 tok/s 指标；缺省只验证连通。 */
  mode?: "connectivity" | "speed";
}

export interface ModelConnectivityProbeResult {
  metrics?: ModelSpeedProbeMetrics;
}

/**
 * 测速 prompt 每次注入 seed + 随机词：供应商对完全相同的请求前缀有 KV 缓存，
 * 固定字符串会让 TTFT 失真；decode 吞吐虽与 prefill 无关，但整响应缓存会让
 * 两次测速失去独立性。decode 吞吐与内容熵无关，随机词只为缓存失效。
 */
export function buildSpeedProbeUserPrompt(now: number = Date.now(), random = Math.random): string {
  const seed = `${now.toString(36)}-${Math.floor(random * 0xffffffff).toString(36)}`;
  const word = SPEED_PROBE_SEED_WORDS[Math.floor(random * SPEED_PROBE_SEED_WORDS.length)]!;
  return [
    `Throughput probe session ${seed}.`,
    `Write exactly ${SPEED_PROBE_TARGET_LINES} numbered lines.`,
    `Each line: the line number, then one short sentence about the word "${word}".`,
    "No preamble, no closing remarks.",
  ].join(" ");
}

/** decodeWindow 同口径：decode = 首内容 → 流结束；任一项不可用则整体省略。 */
export function computeSpeedProbeMetrics(input: {
  startedAt: number;
  firstContentAt: number | null;
  finishedAt: number;
  outputTokens: number | undefined;
}): ModelSpeedProbeMetrics | undefined {
  const { startedAt, firstContentAt, finishedAt, outputTokens } = input;
  if (firstContentAt === null || outputTokens === undefined || outputTokens <= 0) return undefined;
  const ttftMs = Math.max(0, firstContentAt - startedAt);
  const decodeMs = finishedAt - firstContentAt;
  if (decodeMs <= 0) return undefined;
  return {
    outputTokens,
    ttftMs,
    decodeMs,
    decodeTps: (outputTokens * 1000) / decodeMs,
  };
}

export async function testModelConnectivity(
  this: AgentRuntimeInternal,
  input: ModelConnectivityTestInput,
  options?: { abortSignal?: AbortSignal; traceContext?: TraceContext },
): Promise<ModelConnectivityProbeResult> {
  const speed = input.mode === "speed";
  const baseModel = createRuntimeModel(this, { selection: input.selection, scope: "workspace" });
  // 连接探测不需要生成正文；复用辅助生成的 5,000 预算会等待多余推理和输出。
  // 独立限制为 1 Token，仍使用最低公开档位，不改变其他辅助调用的预算。
  // 测速模式需要足量 decode tokens 才能形成稳定窗口；随机 prompt 每次防缓存。
  const model = baseModel.bind({
    reasoningLevel: baseModel.optionSpecs.reasoningLevel.values[0]!,
    maxOutputTokens: speed ? SPEED_PROBE_MAX_OUTPUT_TOKENS : CONNECTIVITY_PROBE_MAX_OUTPUT_TOKENS,
  });
  const querySource = speed
    ? PROVIDER_SETTINGS_SPEED_TEST_QUERY_SOURCE
    : "provider_settings_connectivity";
  const traceContext = createChildTraceContext(options?.traceContext ?? this.rootTraceContext, {
    attributes: {
      providerId: String(model.providerId),
      modelId: String(model.modelId),
      querySource,
    },
  });
  const abortSignal =
    options?.abortSignal ??
    AbortSignal.timeout(speed ? SPEED_PROBE_TIMEOUT_MS : WORKSPACE_GENERATE_TEXT_TIMEOUT_MS);
  const request: ModelRequest = {
    abortSignal,
    messages: [
      { role: "system", content: CONNECTIVITY_PROBE_SYSTEM },
      {
        role: "user",
        content: speed ? buildSpeedProbeUserPrompt() : CONNECTIVITY_PROBE_USER,
      },
    ],
  };
  let finished = false;
  let finishedAt = 0;
  let firstContentAt: number | null = null;
  let outputTokens: number | undefined;
  const startedAt = Date.now();
  await runWithModelInvocationContext(
    {
      metadata: traceContextToLogContext(traceContext),
      modelCall: { operation: "workspace_generate_text" },
      statusSink: this.createModelStatusSink(traceContext, []),
      traceContext,
      refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(this, {
        abortSignal,
        model,
        traceContext,
      }),
    },
    async () => {
      for await (const event of model.streamText(request)) {
        if (event.type === "error") throw normalizeStreamError(event.error);
        // 首个正文 delta 即解码起点；start/compact 边界与推理 delta 不算内容。
        if (event.type === "text_delta" && firstContentAt === null) {
          firstContentAt = Date.now();
        }
        if (event.type === "finish") {
          finished = true;
          finishedAt = Date.now();
          outputTokens = event.usage?.outputTokens;
        }
      }
    },
  );
  if (!finished) throw new Error("模型连通性测试流在 finish 事件前结束");
  if (!speed) return {};
  // 计时缺失（如适配器未产出 delta/usage）时指标整体省略，调用方按普通成功处理。
  const metrics = computeSpeedProbeMetrics({ startedAt, firstContentAt, finishedAt, outputTokens });
  return metrics ? { metrics } : {};
}

export async function generateWorkspaceText(
  this: AgentRuntimeInternal,
  input: WorkspaceGenerateTextInput,
  options?: { abortSignal?: AbortSignal; traceContext?: TraceContext },
): Promise<WorkspaceGenerateTextResult> {
  assertWorkspaceModelInput(input);
  const querySource = input.querySource.trim() || "workspace_generate_text";
  const traceContext = options?.traceContext ?? this.rootTraceContext;
  const operationTelemetry = this.agentTelemetry.detached({
    executionKind: "foreground",
    operation:
      querySource === GIT_COMMIT_MESSAGE_QUERY_SOURCE
        ? "workspace_git_commit_message"
        : "workspace_generate_text",
    targetKind: "workspace",
    trigger: "user",
    traceContext,
  });
  return operationTelemetry.run(async () => {
    try {
      const result = await generateWorkspaceTextImpl.call(this, input, options);
      operationTelemetry.setResultType("text");
      operationTelemetry.finishCompleted();
      return result;
    } catch (error) {
      if (options?.abortSignal?.aborted) {
        operationTelemetry.finishCancelled("abort_signal");
      } else {
        operationTelemetry.finishFailed("execute", "unknown", error);
      }
      throw error;
    }
  });
}

async function generateWorkspaceTextImpl(
  this: AgentRuntimeInternal,
  input: WorkspaceGenerateTextInput,
  options?: { abortSignal?: AbortSignal; traceContext?: TraceContext },
): Promise<WorkspaceGenerateTextResult> {
  assertWorkspaceModelInput(input);
  const requestedSelection = input.selection;
  const querySource = input.querySource.trim() || "workspace_generate_text";
  const baseModel = createRuntimeModel(this, { selection: requestedSelection, scope: "workspace" });
  // 辅助请求需要的是最低公开档位，不是扫描 off/nothink 等名称后强制关闭。
  // 输入预测按键触发、要求低延迟，同样走最低档位。
  const model =
    querySource === GIT_COMMIT_MESSAGE_QUERY_SOURCE || querySource === INPUT_PREDICTION_QUERY_SOURCE
      ? baseModel.bind(auxiliaryModelOptions(baseModel))
      : baseModel;
  const baseTraceContext = options?.traceContext ?? this.rootTraceContext;
  const modelTraceContext = createChildTraceContext(baseTraceContext, {
    attributes: {
      model: `${model.providerId}/${model.modelId}`,
      querySource,
    },
  });

  const events: SessionEvent[] = [];
  const messages: ModelInputMessage[] = input.messages
    ? input.messages.map((message) => ({ ...message }))
    : [{ role: "user", content: input.prompt!.trim() }];
  const tools = input.tools ?? [];
  const modelRequestEvent = this.createEvent(
    SessionEventType.ModelRequest,
    {
      messages,
      providerId: String(model.providerId),
      modelId: String(model.modelId),
      querySource,
      toolCount: tools.length,
    },
    modelTraceContext,
  );
  await this.appendEvent(modelRequestEvent, modelTraceContext);
  events.push(modelRequestEvent);

  const modelStartedAt = Date.now();
  const networkEventStartIndex = events.length;
  const abortSignal =
    options?.abortSignal ?? AbortSignal.timeout(WORKSPACE_GENERATE_TEXT_TIMEOUT_MS);
  // Git Commit 调用方曾传入固定 256，Core 又按 querySource 丢弃，形成虚假接口。
  // 通用生成入口只处理调用方真实提供的预算；Git 辅助调用不再由上游伪造固定上限。
  const requestMaxOutputTokens =
    querySource === GIT_COMMIT_MESSAGE_QUERY_SOURCE ? undefined : input.maxOutputTokens;

  const modelRequest = {
    abortSignal,
    messages,
    tools,
    ...(requestMaxOutputTokens === undefined
      ? {}
      : { options: { maxOutputTokens: requestMaxOutputTokens } }),
  };

  const result = await runWithModelInvocationContext(
    {
      metadata: traceContextToLogContext(modelTraceContext),
      modelCall: {
        operation:
          querySource === GIT_COMMIT_MESSAGE_QUERY_SOURCE
            ? "workspace_git_commit_message"
            : "workspace_generate_text",
        ...(querySource === GIT_COMMIT_MESSAGE_QUERY_SOURCE && model.options.reasoningLevel
          ? { reasoning: { requestedLevel: model.options.reasoningLevel } }
          : {}),
      },
      statusSink: this.createModelStatusSink(modelTraceContext, events),
      traceContext: modelTraceContext,
      refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(this, {
        abortSignal,
        model,
        traceContext: modelTraceContext,
      }),
    },
    () => model.generateText(modelRequest),
  ).catch(async (error: unknown) => {
    await recordModelUsageFact(this, {
      error,
      events,
      model,
      networkEventStartIndex,
      querySource,
      startedAt: modelStartedAt,
      status: "error",
      traceContext: modelTraceContext,
    });
    throw error;
  });

  const toolCalls = this.extractToolCallsFromResult(result);
  const modelCompleteEvent = this.createEvent(
    SessionEventType.ModelComplete,
    {
      content: result.text,
      querySource,
      stopReason: result.finishReason,
      toolCallCount: toolCalls.length,
      usage: result.usage,
    },
    modelTraceContext,
  );
  await this.appendEvent(modelCompleteEvent, modelTraceContext);
  events.push(modelCompleteEvent);
  await recordModelUsageFact(this, {
    events,
    model,
    networkEventStartIndex,
    querySource,
    result,
    startedAt: modelStartedAt,
    status: "completed",
    toolCallCount: toolCalls.length,
    traceContext: modelTraceContext,
  });

  return {
    text: result.text,
    selection: {
      providerId: requestedSelection.providerId,
      modelId: requestedSelection.modelId,
      ...(requestedSelection.options ? { options: { ...requestedSelection.options } } : {}),
    },
    finishReason: result.finishReason,
    usage: result.usage,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function assertWorkspaceModelInput(input: WorkspaceGenerateTextInput): void {
  if (input.messages && input.messages.length > 0) return;
  if (input.prompt?.trim()) return;
  throw new Error("模型文本生成 prompt 或 messages 不能为空");
}
