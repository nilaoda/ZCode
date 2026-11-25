#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const argv = process.argv.slice(2);

function readArg(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

const artifactPath = readArg("--artifact-path");
if (!artifactPath) {
  throw new Error("Usage: audit-bundle-size.mjs --artifact-path <path-to-artifact>");
}

const absoluteArtifactPath = resolve(artifactPath);
// 内网发行版随包内置五个预装工具归档（mac ~550MB / win ~700MB），
// 安装包体积上限单独放宽；上游身份仍按 500MiB 审计。
const isLocalIdentity = ["1", "true", "yes", "on"].includes(
  (process.env.ZCODE_LOCAL_IDENTITY ?? "").trim().toLowerCase(),
);
const limitMb = isLocalIdentity ? 1200 : 500;
const limitsMb = {
  default: limitMb,
  ".dmg": limitMb,
  ".zip": limitMb,
  ".exe": limitMb,
  ".appimage": limitMb,
  ".deb": limitMb,
};

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const artifactStat = await stat(absoluteArtifactPath);
const extension = extname(absoluteArtifactPath).toLowerCase();
const limit = limitsMb[extension] ?? limitsMb.default;
const sizeMiB = artifactStat.size / 1024 / 1024;

console.log(`Artifact: ${absoluteArtifactPath}`);
console.log(`Type: ${extension || "<no-extension>"}`);
console.log(`Size: ${formatMiB(artifactStat.size)}`);
console.log(`Limit: ${limit} MiB`);

if (sizeMiB > limit) {
  console.error("Bundle size audit failed:");
  console.error(`  - Artifact exceeds ${limit} MiB`);
  process.exit(1);
}
