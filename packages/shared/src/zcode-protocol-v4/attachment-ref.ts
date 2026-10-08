import { z } from "zod";
import { modelSelectionSchema } from "../model-selection.js";

/** 仅承载已提交内容引用与展示元信息；内容本体不进入 command/topic frame。 */
export const attachmentRefSchema = z
  .object({
    ref: z.string(),
    fileName: z.string(),
    mime: z.string(),
    bytes: z.number(),
    previewRef: z.string().optional(),
    visionModel: modelSelectionSchema.optional(),
  })
  .strict();

export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
