#!/usr/bin/env node

// 预装工具归档暂存：把当前 target 平台的 catalog 资源下载到
// packages/desktop/bundled-tools/<platform-key>/preinstalled-tools/<archive.path>，
// 由 electron-builder 的 extraResources 打进安装包。见
// docs/preinstalled-tools/local-archive-source.md。
//
// 用法：
//   node scripts/prepare-preinstalled-tool-archives.mjs
//   node scripts/prepare-preinstalled-tool-archives.mjs --verify-only
//
// 来源：ZCODE_PREINSTALLED_TOOLS_ARCHIVE_SOURCE（逗号分隔，http(s) 基址或本地目录）。
// 未设置时使用 catalog 的官方 CDN；该地址只用于构建机，不进入产品运行期。

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(repoRoot, "packages/desktop/src/preinstalled-tools/catalog.json");
const defaultSource = "https://cdn-zcode.z.ai/zcode/preinstalled-tools";
const verifyOnly = process.argv.includes("--verify-only");
// 调试用：只处理指定工具，便于验证单个小归档的下载链路。
const toolFilterArg = process.argv.indexOf("--tool");
const toolFilter = toolFilterArg === -1 ? undefined : process.argv[toolFilterArg + 1];

function normalizePlatform(raw) {
  const value = (raw ?? "").toLowerCase();
  if (["mac", "macos", "darwin", "osx"].includes(value)) return "darwin";
  if (["win", "windows", "win32"].includes(value)) return "win32";
  if (value === "linux") return "linux";
  throw new Error(`Unsupported target OS: ${raw}`);
}

function normalizeArch(raw) {
  const value = (raw ?? "").toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(value)) return "x64";
  if (["arm64", "aarch64"].includes(value)) return "arm64";
  throw new Error(`Unsupported target arch: ${raw}`);
}

const platform = normalizePlatform(process.env.ZCODE_TARGET_OS || process.platform);
const arch = normalizeArch(process.env.ZCODE_TARGET_ARCH || process.arch);
const platformKey = `${platform}-${arch}`;
const outputRoot = resolve(
  repoRoot,
  "packages/desktop/bundled-tools",
  platformKey,
  "preinstalled-tools",
);

function resolveSources() {
  const raw = process.env.ZCODE_PREINSTALLED_TOOLS_ARCHIVE_SOURCE?.trim();
  if (!raw) return [defaultSource];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function archivePathFor(resource) {
  return resource.archive.path;
}

function targetPathFor(resource) {
  return join(outputRoot, ...archivePathFor(resource).split("/"));
}

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function matches(path, resource) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.size !== resource.archive.sizeBytes) return false;
  return (await sha256Of(path)) === resource.archive.sha256;
}

async function writeVerified(tempPath, targetPath, resource) {
  const info = await stat(tempPath);
  if (info.size !== resource.archive.sizeBytes)
    throw new Error(
      `大小不符: ${resource.resourceId} ${info.size} != ${resource.archive.sizeBytes}`,
    );
  if ((await sha256Of(tempPath)) !== resource.archive.sha256)
    throw new Error(`SHA-256 不符: ${resource.resourceId}`);
  await mkdir(dirname(targetPath), { recursive: true });
  // Windows 上 rename 不覆盖已存在文件；损坏的旧归档先删除再发布。
  await rm(targetPath, { force: true });
  await rename(tempPath, targetPath);
}

function isHttpSource(source) {
  return /^https?:\/\//u.test(source);
}

function joinSource(source, relativePath) {
  return `${source.replace(/\/+$/u, "")}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function download(source, targetPath, resource) {
  const url = isHttpSource(source) ? joinSource(source, archivePathFor(resource)) : null;
  const tempPath = `${targetPath}.part`;
  await mkdir(dirname(targetPath), { recursive: true });
  await rm(tempPath, { force: true });
  if (!url) {
    // 本地目录来源：直接复制到临时文件后校验。
    const localPath = isAbsolute(source)
      ? join(source, ...archivePathFor(resource).split("/"))
      : resolve(repoRoot, source, ...archivePathFor(resource).split("/"));
    await copyFile(localPath, tempPath);
  } else {
    const response = await fetch(url, { headers: { "accept-encoding": "identity" } });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`下载失败 ${url}: HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  }
  try {
    await writeVerified(tempPath, targetPath, resource);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const resources = catalog
  .filter((tool) => !toolFilter || tool.toolId === toolFilter)
  .flatMap((tool) =>
    tool.resources.filter((resource) =>
      resource.platforms.some((target) => target.platform === platform && target.arch === arch),
    ),
  );

if (resources.length === 0) {
  console.log(`[preinstalled-tool-archives] ${platformKey} 没有 catalog 资源，跳过`);
  process.exit(0);
}

const sources = resolveSources();
let downloaded = 0;
let reused = 0;

for (const resource of resources) {
  const targetPath = targetPathFor(resource);
  if (await matches(targetPath, resource)) {
    reused += 1;
    console.log(`[preinstalled-tool-archives] 复用 ${resource.resourceId}`);
    continue;
  }
  if (verifyOnly) throw new Error(`[preinstalled-tool-archives] 缺少或损坏的归档: ${targetPath}`);

  let lastError;
  for (const source of sources) {
    try {
      console.log(`[preinstalled-tool-archives] 获取 ${resource.resourceId} <- ${source}`);
      await download(source, targetPath, resource);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      console.warn(
        `[preinstalled-tool-archives] 来源失败 ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (lastError) throw lastError;
  downloaded += 1;
}

console.log(
  `[preinstalled-tool-archives] ${platformKey}: 下载 ${downloaded} 个，复用 ${reused} 个，目录 ${outputRoot}`,
);
