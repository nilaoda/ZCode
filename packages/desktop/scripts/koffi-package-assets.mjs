// Koffi native runtime staging for the bundled Windows Agent.
//
// Agent 的 MCP Job Object 通过外置 Koffi 管理 Windows 子进程；
// 安装包没有 workspace 的 hoisted node_modules，须在 zcode.cjs 同级暂存目标原生模块。
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveKoffiRoot(koffiPackageRoot) {
  const candidates = [
    resolve(koffiPackageRoot),
    resolve(koffiPackageRoot, "node_modules", "koffi"),
  ];
  const virtualStore = resolve(koffiPackageRoot, "..", "..", "..", "..", "node_modules", ".pnpm");
  candidates.push(resolve(virtualStore, "..", "koffi"));
  if (await exists(virtualStore)) {
    for (const entry of await readdir(virtualStore)) {
      if (entry.startsWith("koffi@"))
        candidates.push(resolve(virtualStore, entry, "node_modules", "koffi"));
    }
  }
  for (const candidate of candidates) {
    const packageJson = resolve(candidate, "package.json");
    if (!(await exists(packageJson))) continue;
    try {
      if (JSON.parse(await readFile(packageJson, "utf8")).name === "koffi") return candidate;
    } catch {
      // Continue searching other installation locations.
    }
  }
  throw new Error(
    `[koffi-package-assets] cannot resolve installed koffi package from ${koffiPackageRoot}`,
  );
}

function koffiPlatformKey(targetPlatform) {
  return `${targetPlatform.os}_${targetPlatform.arch}`;
}

export async function stageKoffiIntoBundledAgents({ koffiPackageRoot, glmDir, targetPlatform }) {
  if (!koffiPackageRoot || !glmDir || !targetPlatform?.os || !targetPlatform?.arch) {
    throw new Error(
      "[koffi-package-assets] koffiPackageRoot, glmDir and targetPlatform are required",
    );
  }
  const sourceRoot = await resolveKoffiRoot(koffiPackageRoot);
  const platformKey = koffiPlatformKey(targetPlatform);
  const sourceNativeDir = resolve(sourceRoot, "build", "koffi", platformKey);
  if (!(await exists(resolve(sourceNativeDir, "koffi.node")))) {
    throw new Error(
      `[koffi-package-assets] missing target native addon: ${sourceNativeDir}/koffi.node`,
    );
  }

  const targetRoot = resolve(glmDir, "node_modules", "koffi");
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(resolve(targetRoot, "build", "koffi", platformKey), { recursive: true });
  for (const file of ["index.js", "package.json", "index.d.ts", "LICENSE.txt"]) {
    await cp(resolve(sourceRoot, file), resolve(targetRoot, file));
  }
  await cp(
    resolve(sourceNativeDir, "koffi.node"),
    resolve(targetRoot, "build", "koffi", platformKey, "koffi.node"),
  );
  return resolve(targetRoot, "build", "koffi", platformKey, "koffi.node");
}

export async function verifyStagedKoffi({ resourcesDir, targetPlatform, pluginRelativePath = "" }) {
  // 新 CUA 插件只有 SDK；实际外置 Koffi 消费者是 Windows Agent，其他平台无需校验。
  if (targetPlatform.os !== "win32") return [];
  const platformKey = koffiPlatformKey(targetPlatform);
  const koffiRoot = resolve(resourcesDir, "glm", pluginRelativePath, "node_modules", "koffi");
  const nativePath = resolve(koffiRoot, "build", "koffi", platformKey, "koffi.node");
  return (await exists(nativePath)) && (await exists(resolve(koffiRoot, "index.js")))
    ? []
    : [`missing staged koffi runtime for ${platformKey}: ${nativePath}`];
}
