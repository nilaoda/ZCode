import { createHash } from "node:crypto";
import type {
  ModelImageContentBlock,
  ModelInputMessage,
  ToolArtifactStorePort,
} from "@zcode/contracts";
import { officialCuaImageRefIndexesForUnavailableMedia } from "./official-cua-media.js";
import { projectMessagesWithMediaAttachmentPaths } from "./media-attachment-path.js";

/** 引用只由会话图片及其用户选择派生，恢复后不依赖临时 path 或 part ID。 */
export function visionImageReference(image: ModelImageContentBlock): string {
  if (image.source?.visionReference) return image.source.visionReference;
  const identity = image.source?.uri ?? image.source?.path ?? image.dataUrl;
  return `vision-image:${createHash("sha256")
    .update(JSON.stringify([identity, image.source?.visionModel ?? null]))
    .digest("hex")}`;
}

export function findVisionImage(
  messages: readonly ModelInputMessage[],
  reference: string,
): ModelImageContentBlock | undefined {
  for (const message of [...messages].reverse()) {
    if (!Array.isArray(message.content)) continue;
    const blocked = officialCuaImageRefIndexesForUnavailableMedia(
      message.content,
      new Set(message.content.flatMap((block, index) => (block.type === "image" ? [index] : []))),
    );
    for (let index = message.content.length - 1; index >= 0; index--) {
      const block = message.content[index];
      if (block.type !== "image" || blocked.has(index + 1)) continue;
      if (
        visionImageReference(block) === reference ||
        block.source?.uri === reference ||
        block.source?.path === reference ||
        block.source?.originalPath === reference
      )
        return block;
    }
  }
  return undefined;
}

export async function resolveVisionImageReference(
  messages: ModelInputMessage[],
  reference: string,
  artifactStore?: ToolArtifactStorePort,
): Promise<ModelImageContentBlock | undefined> {
  const direct = findVisionImage(messages, reference);
  // 原始路径只是已接纳快照的别名；先查会话事实，不能因为冷恢复换成派生 path 而丢失选择。
  if (direct || reference.startsWith("vision-image:") || reference.includes("://")) return direct;
  return findVisionImage(
    await projectMessagesWithMediaAttachmentPaths(messages, artifactStore),
    reference,
  );
}

export function projectVisionImages(
  messages: ModelInputMessage[],
  supportsImage: boolean,
  enabled: boolean,
): ModelInputMessage[] {
  let changed = false;
  const projected = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const blocked = officialCuaImageRefIndexesForUnavailableMedia(
      message.content,
      new Set(message.content.flatMap((block, index) => (block.type === "image" ? [index] : []))),
    );
    let messageChanged = false;
    const content = message.content.map((block, index) => {
      if (block.type !== "image" || blocked.has(index + 1)) return block;
      if (!block.source?.visionModel && supportsImage) return block;
      if (!enabled) {
        // 这里投影的是整个历史。历史图片不能让后续纯文本 turn 失败，也不能偷偷交给主模型。
        // 新图片的明确拒绝留在 resolveTurnAttachments，只针对本次提交执行。
        changed = messageChanged = true;
        return {
          type: "text" as const,
          text: `[Image: ${block.source?.placeholder ?? "attachment"}] ${
            block.source?.visionModel
              ? "The user's selected vision model is unavailable because InspectImage is not enabled. Do not substitute the main model or another model."
              : "The main model cannot see this image and InspectImage is unavailable."
          } Existing text findings remain available; enable the vision assistant to inspect this image again.`,
        };
      }
      changed = messageChanged = true;
      return {
        type: "text" as const,
        text: `[Image: ${block.source?.placeholder ?? "attachment"}] Use InspectImage with file_path=${JSON.stringify(visionImageReference(block))} and a specific question to view this image. ${block.source?.visionModel ? "Use the user's selected vision model; do not substitute another model." : "The main model cannot see this image directly."}`,
      };
    });
    return messageChanged ? { ...message, content } : message;
  });
  return changed ? projected : messages;
}
