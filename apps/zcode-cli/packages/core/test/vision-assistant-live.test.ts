import assert from "node:assert/strict";
import test from "node:test";
import { VISION_ASSISTANT_AGENT_NAME } from "@zcode/shared";
import { createToolRegistry } from "../src/tool/registry.js";
import { refreshVisionAssistantConfig } from "../src/runtime/helpers/vision-assistant-config.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";

const profile = (modelId: string) => ({
  name: VISION_ASSISTANT_AGENT_NAME,
  description: "vision",
  tools: [],
  systemPrompt: "Inspect",
  modelSelection: { providerId: "test", modelId },
});

test("旧 runtime 在新轮重读全局配置，启停和换模型刷新工具缓存及 profile", async () => {
  let snapshot = { enabled: false, profile: undefined as ReturnType<typeof profile> | undefined };
  const existing = { name: "custom", description: "custom", systemPrompt: "custom" };
  const runtime = {
    config: { subagents: { profiles: [existing] }, runtimeFeatures: { computerUse: true } },
    registry: createToolRegistry(),
    subagentPort: {},
    cachedTools: [],
    visionAssistantConfigPort: { read: async () => snapshot },
  } as unknown as AgentRuntimeInternal;
  snapshot = { enabled: true, profile: profile("vision-a") };
  await refreshVisionAssistantConfig(runtime);
  assert.equal(runtime.registry.has("InspectImage"), true);
  assert.equal(runtime.cachedTools, null);
  assert.equal(runtime.config.runtimeFeatures?.computerUse, true);
  assert.ok(runtime.config.subagents?.profiles?.includes(existing));
  snapshot = { enabled: true, profile: profile("vision-b") };
  await refreshVisionAssistantConfig(runtime);
  assert.equal(
    runtime.config.subagents?.profiles?.find((p) => p.name === VISION_ASSISTANT_AGENT_NAME)
      ?.modelSelection?.modelId,
    "vision-b",
  );
  snapshot = { enabled: false, profile: undefined };
  await refreshVisionAssistantConfig(runtime);
  assert.equal(runtime.registry.has("InspectImage"), false);
  assert.deepEqual(runtime.config.subagents?.profiles, [existing]);
  snapshot = { enabled: true, profile: profile("vision-a") };
  await refreshVisionAssistantConfig(runtime);
  assert.equal(runtime.registry.has("InspectImage"), true);
});

test("配置读取失败明确失败，子会话与工具禁用规则不能被热启用绕过", async () => {
  const runtime = {
    config: { taskType: "subagent_child", subagents: { profiles: [] } },
    registry: createToolRegistry(),
    subagentPort: {},
    visionAssistantConfigPort: {
      read: async () => ({ enabled: true, profile: profile("vision-a") }),
    },
  } as unknown as AgentRuntimeInternal;
  await refreshVisionAssistantConfig(runtime);
  assert.equal(runtime.registry.has("InspectImage"), false);
  runtime.config.taskType = undefined;
  runtime.config.toolDisallowlist = ["InspectImage"];
  await refreshVisionAssistantConfig(runtime);
  assert.equal(runtime.registry.has("InspectImage"), false);
  runtime.visionAssistantConfigPort = {
    read: async () => {
      throw new Error("read failed");
    },
  };
  await assert.rejects(refreshVisionAssistantConfig(runtime), /read failed/);
});

test("已有子代理 runner 新调用使用新模型，已启动识图保留旧 profile", async () => {
  const { createExploreSubagentPort } = await import("../src/subagent/runner.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "zcode-live-vision-runner-"));
  let profiles = [profile("vision-a")];
  const captured: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const port = createExploreSubagentPort({
    outputRootDir: root,
    getProfiles: () => profiles,
    autoBackgroundMs: 0,
    emitParentEvent: async () => {},
    runExploreAgent: async (request) => {
      const model = request.profile.modelSelection!.modelId;
      if (model === "vision-a") {
        firstStarted();
        await blocked;
      }
      captured.push(request.profile.modelSelection!.modelId);
      return { response: model, events: [], traceId: "trace" };
    },
  });
  const request = {
    sessionId: "s",
    parentToolCallId: "tool",
    agentType: VISION_ASSISTANT_AGENT_NAME,
    description: "Inspect",
    prompt: "question",
    workingDirectory: root,
    workspaceRoot: root,
    trace: { traceId: "trace" },
  };
  try {
    const first = port.run(request as never);
    await started;
    profiles = [profile("vision-b")];
    await port.run({ ...request, parentToolCallId: "tool-2" } as never);
    release();
    await first;
    assert.deepEqual(captured, ["vision-b", "vision-a"]);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

test("同一旧会话连续执行与排队输入在执行边界接入最新视觉配置", async () => {
  const { AgentRuntime } = await import("../src/runtime.js");
  const { createInMemorySessionEventStore } = await import("@zcode/contracts");
  let enabled = false;
  let modelId = "vision-a";
  const tools: string[][] = [];
  let pause = false;
  let release!: () => void;
  let notifyStarted!: () => void;
  let started: Promise<void>;
  const model = {
    providerId: "test",
    modelId: "text",
    options: {},
    optionSpecs: { maxOutputTokens: { max: 8192 }, reasoningLevel: { values: ["none"] } },
    async generateText(request: { tools?: { name: string }[] }) {
      for await (const event of this.streamText(request)) {
        void event;
      }
      return {
        text: "done",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    properties: { inputFormat: { supportsImage: false }, contextWindow: 128000 },
    async *streamText(request: { tools?: { name: string }[] }) {
      tools.push(request.tools?.map((tool) => tool.name) ?? []);
      if (pause) {
        pause = false;
        notifyStarted();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      yield { type: "text_delta", text: "done" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const runtime = new AgentRuntime(
    "live-session" as never,
    {
      workingDirectory: process.cwd(),
      modelSelection: { providerId: "test", modelId: "text" },
      memory: { enabled: false },
    },
    {
      eventStore: createInMemorySessionEventStore(),
      modelFactory: () => model,
      visionAssistantConfigPort: {
        read: async () => ({ enabled, profile: enabled ? profile(modelId) : undefined }),
      },
    } as never,
  );
  await runtime.executeTurn("first turn");
  assert.equal(tools.at(-1)?.includes("InspectImage"), false);
  enabled = true;
  await runtime.executeTurn("second turn", [
    {
      type: "image",
      content:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    },
  ]);
  assert.equal(tools.at(-1)?.includes("InspectImage"), true);
  pause = true;
  started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const first = runtime.executeTurn("running turn");
  await started;
  const queued = runtime.executeTurn("queued turn");
  enabled = false;
  modelId = "vision-b";
  release();
  await first;
  await queued;
  assert.equal(tools.at(-2)?.includes("InspectImage"), true);
  assert.equal(tools.at(-1)?.includes("InspectImage"), false);
});
