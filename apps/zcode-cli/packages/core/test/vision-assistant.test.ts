import assert from "node:assert/strict";
import test from "node:test";
import {
  projectVisionImages,
  findVisionImage,
  visionImageReference,
} from "../src/runtime/helpers/vision-assistant.js";
import type { ModelInputMessage, ModelImageContentBlock } from "@zcode/contracts";

const image: ModelImageContentBlock = {
  type: "image",
  mediaType: "image/png",
  dataUrl: "data:image/png;base64,YQ==",
  source: {
    id: "image",
    kind: "inline",
    uri: "zcode-artifact://test/image",
    mimeType: "image/png",
  },
};
const selected = {
  ...image,
  source: { ...image.source!, visionModel: { providerId: "test", modelId: "vision" } },
};
const messages = (block = image): ModelInputMessage[] => [{ role: "user", content: [block] }];

test("自动路由优先使用主模型原生视觉，原始消息不变", () => {
  const input = messages();
  assert.equal(projectVisionImages(input, true, true), input);
  const delegated = projectVisionImages(input, false, true);
  assert.match(JSON.stringify(delegated), /InspectImage/);
  assert.equal(input[0].content[0], image);
});

test("主动指定优先于主模型，逐图生效，插件关闭时明确拒绝", () => {
  const input: ModelInputMessage[] = [{ role: "user", content: [image, selected] }];
  const result = projectVisionImages(input, true, true);
  assert.equal(result[0].content[0], image);
  assert.equal(result[0].content[1].type, "text");
  const unavailable = projectVisionImages(messages(selected), true, false);
  assert.equal(unavailable[0].content[0].type, "text");
  assert.match(JSON.stringify(unavailable), /unavailable/);
  assert.equal(projectVisionImages(messages(), true, false)[0].content[0], image);
});

test("识图引用来自会话事实，选择和重建后引用一致", () => {
  assert.notEqual(visionImageReference(image), visionImageReference(selected));
  assert.equal(findVisionImage(messages(selected), visionImageReference(selected)), selected);
  assert.equal(findVisionImage(messages(selected), "vision-image:unknown"), undefined);
  const rebuilt = {
    ...selected,
    source: { ...selected.source!, id: "persisted-part", path: "/derived/image.png" },
  };
  assert.equal(visionImageReference(selected), visionImageReference(rebuilt));
});

test("工具只使用已接纳图片的模型选择，并传播图片、trace 和取消", async () => {
  const { inspectImageHandler } = await import("../src/tool/handlers/inspect-image.js");
  const controller = new AbortController();
  let captured: unknown[] = [];
  const context = {
    sessionId: "session-test",
    turnId: "turn-test",
    toolCallId: "tool-test",
    traceId: "trace-test",
    workingDirectory: "/workspace",
    workspaceRoot: "/workspace",
    abortSignal: controller.signal,
    resolveVisionImage: async () => selected,
    subagentPort: {
      run: async (...args: unknown[]) => {
        captured = args;
        return { status: "completed", content: [{ type: "text", text: "A diagram" }] };
      },
    },
  };
  const output = await inspectImageHandler(
    { file_path: visionImageReference(selected), question: "Describe it" },
    context as never,
  );
  const [request, options] = captured as any[];
  assert.deepEqual(request.imageAttachments, [{ type: "image", content: selected.dataUrl }]);
  assert.equal(request.requireImageModel, true);
  assert.equal(request.trace.traceId, "trace-test");
  assert.deepEqual(options.modelOverride.selection, selected.source.visionModel);
  assert.equal(options.modelOverride.background, "deny");
  assert.equal(options.signal, controller.signal);
  assert.equal(output.content[0].text, "A diagram");
  await assert.rejects(() =>
    inspectImageHandler({ file_path: "image", question: "q", model: "forged" }, context as never),
  );
  await assert.rejects(
    () =>
      inspectImageHandler({ file_path: "vision-image:missing", question: "q" }, {
        ...context,
        resolveVisionImage: async () => undefined,
      } as never),
    /no longer available/,
  );
});

test("自动识图不传父模型覆盖，备用模型由子代理配置决定", async () => {
  const { inspectImageHandler } = await import("../src/tool/handlers/inspect-image.js");
  let options: unknown;
  await inspectImageHandler({ file_path: visionImageReference(image), question: "q" }, {
    sessionId: "s",
    toolCallId: "tool",
    traceId: "trace",
    workingDirectory: "/workspace",
    workspaceRoot: "/workspace",
    abortSignal: new AbortController().signal,
    resolveVisionImage: async () => image,
    subagentPort: {
      run: async (_request: unknown, input: unknown) => {
        options = input;
        return {};
      },
    },
  } as never);
  assert.equal((options as any).modelOverride, undefined);
  assert.equal((options as any).model, undefined);
});

test("子代理端口保留图片并按父信号中止，不自动转后台", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createExploreSubagentPort } = await import("../src/subagent/runner.js");
  const directory = await mkdtemp(join(tmpdir(), "zcode-vision-test-"));
  const controller = new AbortController();
  let childRequest: any;
  let childSignal: AbortSignal | undefined;
  let started!: () => void;
  const childStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const port = createExploreSubagentPort({
    outputRootDir: directory,
    autoBackgroundMs: 1,
    profiles: [
      {
        name: "vision-assistant:vision-reader",
        source: "user",
        description: "Vision",
        tools: [],
        systemPrompt: "Inspect",
      },
    ],
    emitParentEvent: async () => {},
    runExploreAgent: async (request, options) => {
      childRequest = request;
      childSignal = options?.signal;
      await request.onSessionReady?.();
      started();
      return new Promise((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        }),
      );
    },
  });
  try {
    const run = port.run(
      {
        sessionId: "s",
        parentToolCallId: "tool",
        agentType: "vision-assistant:vision-reader",
        description: "Inspect",
        prompt: "q",
        workingDirectory: directory,
        workspaceRoot: directory,
        trace: { traceId: "trace" },
        imageAttachments: [{ type: "image", content: image.dataUrl }],
        requireImageModel: true,
      } as never,
      { signal: controller.signal },
    );
    await childStarted;
    assert.deepEqual(childRequest.imageAttachments, [{ type: "image", content: image.dataUrl }]);
    assert.equal(childRequest.requireImageModel, true);
    controller.abort(new Error("User cancelled"));
    await assert.rejects(run);
    assert.equal(childSignal?.aborted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("最终视觉模型不支持图片或备用未配置时，首轮调用前拒绝", async () => {
  const { AgentRuntime } = await import("../src/runtime.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "zcode-vision-model-test-"));
  let calls = 0;
  const model = {
    providerId: "test",
    modelId: "text",
    properties: { inputFormat: { supportsImage: false } },
    generateText: async () => {
      calls++;
    },
  };
  const request = {
    sessionId: "s",
    parentToolCallId: "tool",
    agentType: "vision-assistant:vision-reader",
    description: "Inspect",
    prompt: "q",
    workingDirectory: directory,
    workspaceRoot: directory,
    trace: { traceId: "trace" },
    requireImageModel: true,
    imageAttachments: [{ type: "image", content: image.dataUrl }],
  };
  try {
    for (const configured of [false, true]) {
      const runtime = new AgentRuntime(
        "s" as never,
        {
          workingDirectory: directory,
          modelSelection: { providerId: "test", modelId: "text" },
          subagents: {
            outputRootDir: directory,
            profiles: [
              {
                name: "vision-assistant:vision-reader",
                source: "user",
                description: "Vision",
                tools: [],
                ...(configured ? { modelSelection: { providerId: "test", modelId: "text" } } : {}),
              },
            ],
          },
        },
        {
          eventStore: { append: async (event: unknown) => event },
          modelFactory: () => model,
        } as never,
      );
      await assert.rejects(
        () => (runtime as any).subagentPort.run(request),
        configured ? /does not support images/ : /Configure a backup vision model/,
      );
    }
    assert.equal(calls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("本地图片复用读取与处理端口，图片选择在冷恢复后保留", async () => {
  const { inspectImageHandler } = await import("../src/tool/handlers/inspect-image.js");
  const { filePartToContentBlock } = await import("../src/agent/file-part-hydration.js");
  let path: string | undefined;
  let signal: AbortSignal | undefined;
  const controller = new AbortController();
  let imageContent: unknown;
  await inspectImageHandler({ file_path: "image.png", question: "q" }, {
    sessionId: "s",
    toolCallId: "t",
    traceId: "trace",
    workingDirectory: "/workspace",
    workspaceRoot: "/workspace",
    abortSignal: controller.signal,
    fileSystemPort: {
      readBinaryFile: async (request: { path: string }, options: { signal: AbortSignal }) => {
        path = request.path;
        signal = options.signal;
        return { content: new Uint8Array([1]), sizeBytes: 1 };
      },
    },
    imageProcessorPort: {
      prepareForModel: async () => ({ data: new Uint8Array([1]), mediaType: "image/png" }),
    },
    subagentPort: {
      run: async (request: { imageAttachments: unknown }) => {
        imageContent = request.imageAttachments;
        return {};
      },
    },
  } as never);
  const { resolve } = await import("node:path");
  assert.equal(path, resolve("/workspace", "image.png"));
  assert.equal(signal, controller.signal);
  assert.deepEqual(imageContent, [{ type: "image", content: "data:image/png;base64,AQ==" }]);
  const restored = await filePartToContentBlock(
    {
      id: "part",
      mime: "image/png",
      url: image.source!.uri,
      metadata: { artifactUri: image.source!.uri, visionModel: selected.source.visionModel },
    } as never,
    { readToolResultArtifact: async () => ({ content: image.dataUrl }) } as never,
  );
  assert.equal(restored.type, "image");
  assert.deepEqual(
    (restored as ModelImageContentBlock).source?.visionModel,
    selected.source.visionModel,
  );
  assert.equal(
    visionImageReference(restored as ModelImageContentBlock),
    visionImageReference(selected),
  );
});

test("Read 读取用户指定模型的图片时保留路由，支持视觉的主模型也不能绕过", async () => {
  const { readToolEntry } = await import("../src/tool/handlers/read.js");
  const output = await readToolEntry.handler({ file_path: "/workspace/image.png" }, {
    sessionId: "s",
    toolCallId: "t",
    traceId: "trace",
    workingDirectory: "/workspace",
    workspaceRoot: "/workspace",
    abortSignal: new AbortController().signal,
    resolveVisionImage: async () => selected,
    fileSystemPort: {
      readBinaryFile: async () => ({ content: new Uint8Array([1]), sizeBytes: 1 }),
    },
    imageProcessorPort: {
      prepareForModel: async () => ({ data: new Uint8Array([1]), mediaType: "image/png" }),
    },
  } as never);
  assert.deepEqual(output.visionModel, selected.source.visionModel);
  const content = readToolEntry.formatModelContent!(output);
  const messages = [{ role: "tool", content }] as ModelInputMessage[];
  const projected = projectVisionImages(messages, true, true);
  assert.match(JSON.stringify(projected), /InspectImage/);
  assert.equal(projected[0].content[0].type, "text");
});
