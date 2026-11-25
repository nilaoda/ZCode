import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PreinstalledToolManifest } from "@zcode/shared/preinstalled-tools";
import {
  findBundledArchive,
  resolveBundledArchivePath,
  verifyBundledArchive,
} from "@desktop/preinstalled-tools/localArchive.js";

const resourceId = "qpdf-1.0.0-darwin-arm64-r1";
const archivePath = `qpdf/${resourceId}/${resourceId}.tar.gz`;

function manifestFor(content: Buffer): Pick<PreinstalledToolManifest, "archive" | "resourceId"> {
  return {
    resourceId,
    archive: {
      format: "tar.gz",
      path: archivePath,
      sizeBytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  };
}

describe("预装工具包内归档源", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zcode-preinstalled-archive-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("按 archive.path 的 POSIX 分段定位归档", () => {
    expect(resolveBundledArchivePath(root, manifestFor(Buffer.from("x")))).toBe(
      join(root, "qpdf", resourceId, `${resourceId}.tar.gz`),
    );
  });

  it("目录未配置、文件缺失或目标是目录时返回 null", async () => {
    const manifest = manifestFor(Buffer.from("payload"));
    expect(await findBundledArchive(undefined, manifest)).toBeNull();
    expect(await findBundledArchive(root, manifest)).toBeNull();

    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(target, { recursive: true });
    expect(await findBundledArchive(root, manifest)).toBeNull();
  });

  it("归档存在时返回绝对路径", async () => {
    const content = Buffer.from("payload");
    const manifest = manifestFor(content);
    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
    expect(await findBundledArchive(root, manifest)).toBe(target);
  });

  it("大小与 SHA-256 一致时通过校验", async () => {
    const content = Buffer.from("payload");
    const manifest = manifestFor(content);
    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
    await expect(
      verifyBundledArchive(target, manifest, new AbortController().signal),
    ).resolves.toBe(undefined);
  });

  it("大小不符按 checksum 失败", async () => {
    const manifest = manifestFor(Buffer.from("payload"));
    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, Buffer.from("payload-plus"));
    await expect(
      verifyBundledArchive(target, manifest, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "checksum" });
  });

  it("哈希不符按 checksum 失败", async () => {
    const content = Buffer.from("payload");
    const manifest = manifestFor(content);
    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, Buffer.from("payload"));
    // 同长度、不同内容：只命中哈希分支。
    const tampered = Buffer.from("payloaD");
    await writeFile(target, tampered);
    manifest.archive.sizeBytes = tampered.byteLength;
    await expect(
      verifyBundledArchive(target, manifest, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "checksum" });
  });

  it("已取消的信号让校验失败", async () => {
    const content = Buffer.from("payload");
    const manifest = manifestFor(content);
    const target = resolveBundledArchivePath(root, manifest);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(verifyBundledArchive(target, manifest, controller.signal)).rejects.toThrow();
  });
});
