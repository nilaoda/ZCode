import { resolveWorkspacePath } from "../path-policy.js";
import { z } from "zod";
import { VISION_ASSISTANT_AGENT_NAME } from "@zcode/shared";
import {
  AgentOutputSchema,
  CoreErrorType,
  createCoreError,
  type ModelImageContentBlock,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import { agentToolEntry } from "./agent.js";
import { inferImageMimeFromPath, readImageFile } from "./read-image.js";

const inspectImageInputSchema = z
  .object({
    file_path: z.string().trim().min(1),
    question: z.string().trim().min(1),
  })
  .strict();

export const inspectImageHandler: ToolHandler = async (input, context) => {
  const { file_path: reference, question } = inspectImageInputSchema.parse(input);
  if (!context.subagentPort)
    throw createCoreError(CoreErrorType.ConfigurationError, "Vision assistant is unavailable", {
      recoverable: true,
    });
  const sessionReference = reference.startsWith("vision-image:") || reference.includes("://");
  const imageReference = sessionReference
    ? reference
    : resolveWorkspacePath({
        inputPath: reference,
        operation: "read",
        workingDirectory: context.workingDirectory,
        workspaceRoot: context.workspaceRoot,
      });
  let image: ModelImageContentBlock | undefined =
    await context.resolveVisionImage?.(imageReference);
  if (!image) {
    if (sessionReference) {
      throw createCoreError(
        CoreErrorType.ToolExecutionFailed,
        "Image reference is no longer available in this conversation",
        { recoverable: true },
      );
    }
    const path = imageReference;
    const mime = inferImageMimeFromPath(path);
    if (!mime)
      throw createCoreError(
        CoreErrorType.ToolExecutionFailed,
        "InspectImage requires a PNG, JPEG, GIF or WebP file",
        { recoverable: true },
      );
    const read = await readImageFile(path, mime, context);
    image = {
      type: "image",
      mediaType: read.mimeType,
      dataUrl: `data:${read.mimeType};base64,${read.base64}`,
    };
  }
  const selection = image.source?.visionModel;
  return context.subagentPort.run(
    {
      sessionId: context.sessionId,
      turnId: context.turnId,
      parentToolCallId: context.toolCallId,
      agentType: VISION_ASSISTANT_AGENT_NAME,
      description: "Inspect image",
      prompt: question,
      imageAttachments: [{ type: "image", content: image.dataUrl }],
      requireImageModel: true,
      workingDirectory: context.workingDirectory,
      workspaceRoot: context.workspaceRoot,
      trace: context.traceContext ?? {
        traceId: context.traceId,
        sessionId: context.sessionId,
        turnId: context.turnId,
        spanId: context.spanId,
        parentSpanId: context.parentSpanId,
      },
    },
    {
      signal: context.abortSignal,
      ...(selection ? { modelOverride: { selection, background: "deny" as const } } : {}),
    },
  );
};

export const inspectImageToolEntry: ToolEntry = {
  ...agentToolEntry,
  capability: "Read an image with the configured vision assistant and return text findings",
  metadata: {
    ...agentToolEntry.metadata,
    name: "InspectImage",
    description:
      "Inspect an image using a vision model. Use the vision-image reference supplied in the conversation, or a local image file_path, and ask a focused question. Uploaded images retain the user's chosen model. The main conversation model stays unchanged. This does not provide a CUA coordinate frame.",
  },
  handler: inspectImageHandler,
  formatModelContent: (output) => {
    const result = AgentOutputSchema.parse(output);
    if (result.status === "async_launched")
      throw new Error("Vision assistant must complete in the foreground");
    return [
      result.content.map((block) => block.text).join("\n"),
      `<usage>tokens: ${result.totalTokens ?? "unknown"}; duration_ms: ${result.totalDurationMs}</usage>`,
    ].join("\n");
  },
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", minLength: 1 },
      question: { type: "string", minLength: 1 },
    },
    required: ["file_path", "question"],
    additionalProperties: false,
  },
  runtimeInputSchema: inspectImageInputSchema,
  permission: {
    permission: "read",
    reason: "Read image content and delegate to a vision model",
    riskLevel: "low",
    sideEffectScope: "session",
    needsApproval: false,
    patternSources: ["path"],
    alwaysAllowPatternSources: ["path"],
    denyPriority: "beforeAsk",
  },
};
