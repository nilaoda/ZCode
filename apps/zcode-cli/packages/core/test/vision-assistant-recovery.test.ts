import assert from "node:assert/strict";
import test from "node:test";
import {
  projectVisionImages,
  resolveVisionImageReference,
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

test("关闭插件后历史图片不阻断文本请求，新的显式图片在接纳时拒绝", async () => {
  const { resolveTurnAttachments } = await import("../src/runtime/helpers/attachments.js");
  const history: ModelInputMessage[] = [
    ...messages(selected),
    { role: "assistant", content: "已识别图片" },
    { role: "user", content: "继续回答文本问题" },
  ];
  const projected = projectVisionImages(history, true, false);
  assert.equal(projected[0].content[0].type, "text");
  assert.equal(projected[2].content, history[2].content);
  assert.equal(history[0].content[0], selected);
  await assert.rejects(
    () =>
      resolveTurnAttachments(
        [{ type: "image", content: image.dataUrl, visionModel: selected.source.visionModel }],
        {
          workingDirectory: "/workspace",
          traceContext: { traceId: "trace" } as never,
          visionAssistantAvailable: false,
        },
      ),
    /disabled/,
  );
});

test("真实冷恢复解析保留原始路径与模型选择，Read 拒绝修改后的文件", async () => {
  const { createHash } = await import("node:crypto");
  const { filePartToContentBlock } = await import("../src/agent/file-part-hydration.js");
  const { readToolEntry } = await import("../src/tool/handlers/read.js");
  const { inspectImageHandler } = await import("../src/tool/handlers/inspect-image.js");
  const bytes = new Uint8Array([1]);
  const dataUrl = "data:image/png;base64,AQ==";
  const originalPath = "/workspace/image.png";
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const restored = await filePartToContentBlock(
    {
      id: "part",
      mime: "image/png",
      url: image.source!.uri,
      source: { type: "file", path: originalPath, text: { value: originalPath, start: 0, end: 0 } },
      metadata: {
        artifactUri: image.source!.uri,
        sha256,
        visionModel: selected.source.visionModel,
      },
    } as never,
    { readToolResultArtifact: async () => ({ content: dataUrl }) } as never,
  );
  const history = [{ role: "user", content: [restored] }] as ModelInputMessage[];
  const resolveVisionImage = (reference: string) =>
    resolveVisionImageReference(history, reference, {
      ensureMediaAttachmentPath: async () => ({ status: "ready", path: "/cache/image.png" }),
    } as never);
  let content = bytes;
  let override: unknown;
  const context = {
    sessionId: "s",
    toolCallId: "t",
    traceId: "trace",
    workingDirectory: "/workspace",
    workspaceRoot: "/workspace",
    abortSignal: new AbortController().signal,
    resolveVisionImage,
    fileSystemPort: { readBinaryFile: async () => ({ content, sizeBytes: content.length }) },
    imageProcessorPort: {
      prepareForModel: async ({ data }: { data: Uint8Array }) => ({ data, mediaType: "image/png" }),
    },
    subagentPort: {
      run: async (request: any, options: any) => {
        assert.equal(request.imageAttachments[0].content, dataUrl);
        override = options.modelOverride.selection;
        return {};
      },
    },
  };
  const output = await readToolEntry.handler({ file_path: originalPath }, context as never);
  assert.deepEqual(output.visionModel, selected.source.visionModel);
  await inspectImageHandler({ file_path: originalPath, question: "描述图片" }, context as never);
  assert.deepEqual(override, selected.source.visionModel);
  content = new Uint8Array([2]);
  await assert.rejects(
    () => readToolEntry.handler({ file_path: originalPath }, context as never),
    /changed/,
  );
});

test("Read 工具图片的引用和原始路径经真实持久化及恢复仍稳定", async () => {
  const { persistToolResultMediaAttachments } =
    await import("../src/runtime/helpers/tool-result-media-persistence.js");
  const { filePartToContentBlock } = await import("../src/agent/file-part-hydration.js");
  const readImage = {
    ...selected,
    source: {
      ...selected.source,
      uri: undefined,
      kind: "local_file" as const,
      path: "/workspace/read.png",
    },
  };
  const stored = await persistToolResultMediaAttachments({
    content: [readImage],
    assistantMessageId: "a",
    sessionId: "s",
    turnId: "t",
    toolCallId: "tool",
    toolName: "Read",
    sessionStore: {},
    traceContext: { traceId: "trace" },
    artifactStore: { writeToolResultArtifact: async () => ({ uri: "zcode-artifact://test/read" }) },
  } as never);
  const restored = (await filePartToContentBlock(stored!.attachments[0], {
    readToolResultArtifact: async () => ({ content: readImage.dataUrl }),
  } as never)) as ModelImageContentBlock;
  assert.equal(visionImageReference(readImage), visionImageReference(restored));
  assert.deepEqual(restored.source?.visionModel, readImage.source.visionModel);
  const resolved = await resolveVisionImageReference(
    [{ role: "tool", content: [restored] }],
    readImage.source.path,
  );
  assert.equal(resolved, restored);
});

test("逐图指定的模型同时用于执行和子代理启动展示", async () => {
  const { createExploreSubagentPort } = await import("../src/subagent/runner.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "zcode-vision-display-test-"));
  const events: any[] = [];
  const selection = { providerId: "test", modelId: "explicit-vision" };
  const port = createExploreSubagentPort({
    outputRootDir: directory,
    profiles: [
      {
        name: "vision-assistant:vision-reader",
        source: "user",
        description: "Vision",
        tools: [],
        systemPrompt: "Inspect",
        modelSelection: { providerId: "test", modelId: "backup" },
      },
    ],
    emitParentEvent: async (event) => {
      events.push(event);
    },
    runExploreAgent: async (request, options) => {
      assert.deepEqual(options?.modelOverride?.selection, selection);
      await request.onSessionReady?.();
      return { response: "A diagram", events: [] } as never;
    },
  });
  try {
    await port.run(
      {
        sessionId: "s",
        parentToolCallId: "tool",
        agentType: "vision-assistant:vision-reader",
        description: "Inspect",
        prompt: "q",
        workingDirectory: directory,
        workspaceRoot: directory,
        trace: { traceId: "trace" },
        requireImageModel: true,
      } as never,
      { modelOverride: { selection, background: "deny" } },
    );
    assert.equal(
      events.find((event) => event.payload?.model)?.payload.model,
      "test/explicit-vision",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
