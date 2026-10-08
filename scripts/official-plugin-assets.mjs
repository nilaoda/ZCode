import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join, posix, resolve, sep } from "node:path";
import { officialSeaPlugins } from "../apps/zcode-cli/packages/cli/scripts/sea-official-plugin-assets.mjs";

// 桌面曾独立维护两项旧清单，漏掉新增视觉插件却打包成功。所有 filesystem 发布入口
// 从 SEA 的公开资源清单派生，内容插件只复制资产，不参与 MCP runtime 编译。
export const officialPluginPackages = officialSeaPlugins.map((plugin) => ({
  ...plugin,
  relativePath: join("apps/zcode-cli", plugin.rootPath),
  stagedPath: plugin.rootPath.split(sep).join("/"),
  requiredSeedPaths: plugin.requiredSeedPaths ?? [],
  requiredRuntimePaths: plugin.requiredRuntimePaths ?? [],
  runtimeBuildScript: plugin.requiresRuntime ? "scripts/build.mjs" : undefined,
}));

export const officialPluginRequiredPaths = officialPluginPackages.flatMap((plugin) =>
  [".zcode-plugin/plugin.json", ...plugin.requiredSeedPaths, ...plugin.requiredRuntimePaths].map(
    (relativePath) => posix.join(plugin.stagedPath, relativePath),
  ),
);

const includedTopLevelPaths = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
];
const excludedNames = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
  ".turbo",
  "coverage",
]);
function shouldCopy(sourcePath) {
  const name = basename(sourcePath);
  return !excludedNames.has(name) && !name.endsWith(".pyc");
}

/** targetRoot 是 zcode.cjs 所在目录；仅 bootstrap 构建前 staging 可暂不校验生成 runtime。 */
export async function stageOfficialPluginAssets({
  repoRoot,
  targetRoot,
  requireRuntime = true,
  log = console.log,
}) {
  for (const plugin of officialPluginPackages) {
    const sourceRoot = resolve(repoRoot, plugin.relativePath);
    const manifestPath = resolve(sourceRoot, ".zcode-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.name !== plugin.name || manifest.version !== plugin.version) {
      throw new Error(`[official-plugin-assets] manifest/version mismatch: ${plugin.name}`);
    }
    const requiredPaths = [
      ...plugin.requiredSeedPaths,
      ...(requireRuntime ? plugin.requiredRuntimePaths : []),
    ];
    for (const relativePath of requiredPaths) {
      const sourcePath = resolve(sourceRoot, ...relativePath.split("/"));
      await access(sourcePath).catch((cause) => {
        throw new Error(
          `[official-plugin-assets] missing ${plugin.name} required asset: ${sourcePath}`,
          { cause },
        );
      });
    }
    const stagedRoot = resolve(targetRoot, plugin.stagedPath);
    await rm(stagedRoot, { recursive: true, force: true });
    await mkdir(stagedRoot, { recursive: true });
    for (const entryName of includedTopLevelPaths) {
      const sourcePath = resolve(sourceRoot, entryName);
      try {
        await access(sourcePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      await cp(sourcePath, resolve(stagedRoot, entryName), { recursive: true, filter: shouldCopy });
    }
    for (const relativePath of [".zcode-plugin/plugin.json", ...requiredPaths]) {
      await access(resolve(stagedRoot, ...relativePath.split("/")));
    }
    log(`[official-plugin-assets] staged ${plugin.stagedPath}`);
  }
}
