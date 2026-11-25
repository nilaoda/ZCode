import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { PreinstalledToolManifest } from "@zcode/shared/preinstalled-tools";
import { PreinstalledToolFailure } from "@desktop/preinstalled-tools/download.js";

/**
 * 包内预装归档：内网发行版把五个工具的 tar.gz 随安装包分发，安装时从包内读取，
 * 不访问 CDN。见 docs/preinstalled-tools/local-archive-source.md。
 *
 * 只做「定位 + 校验」，解压与发布仍走上游同一条安装事务；归档不复制到 staging，
 * 峰值磁盘只算展开后的目录。
 */

/** archive.path 使用 POSIX 分隔符；Windows 上 join 也能正确拼接。 */
export function resolveBundledArchivePath(
  root: string,
  manifest: Pick<PreinstalledToolManifest, "archive">,
): string {
  return join(root, ...manifest.archive.path.split("/"));
}

/** 目录未配置、文件缺失或不是普通文件时返回 null，由调用方决定失败或回退网络。 */
export async function findBundledArchive(
  root: string | undefined,
  manifest: Pick<PreinstalledToolManifest, "archive">,
): Promise<string | null> {
  if (!root) return null;
  const candidate = resolveBundledArchivePath(root, manifest);
  const info = await stat(candidate).catch(() => undefined);
  return info?.isFile() ? candidate : null;
}

/** 大小或 SHA-256 不符按 checksum 失败，不尝试网络候选。 */
export async function verifyBundledArchive(
  archivePath: string,
  manifest: Pick<PreinstalledToolManifest, "archive" | "resourceId">,
  signal: AbortSignal,
): Promise<void> {
  const info = await stat(archivePath);
  if (info.size !== manifest.archive.sizeBytes)
    throw new PreinstalledToolFailure("checksum", `包内归档大小不符: ${manifest.resourceId}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) {
    signal.throwIfAborted();
    hash.update(chunk as Buffer);
  }
  signal.throwIfAborted();
  if (hash.digest("hex") !== manifest.archive.sha256)
    throw new PreinstalledToolFailure("checksum", `包内归档 SHA-256 不符: ${manifest.resourceId}`);
}
