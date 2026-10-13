import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  stageKoffiIntoBundledAgents,
  verifyStagedKoffi,
} from "../scripts/koffi-package-assets.mjs";

it("Windows Agent 根目录可解析 Koffi，暂存仅保留目标架构并可重复执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-koffi-"));
  try {
    const source = join(root, "node_modules", "koffi");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({ name: "koffi", main: "index.js" }),
    );
    await writeFile(join(source, "index.js"), "module.exports = {};\n");
    await writeFile(join(source, "index.d.ts"), "export {};\n");
    await writeFile(join(source, "LICENSE.txt"), "license fixture");
    for (const arch of ["x64", "arm64"]) {
      const directory = join(source, "build", "koffi", `win32_${arch}`);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "koffi.node"), `native fixture ${arch}`);
    }
    const glmDir = join(root, "resources", "glm");
    const adapters = join(root, "apps", "zcode-cli", "packages", "adapters");
    for (const arch of ["x64", "arm64", "x64"]) {
      const targetPlatform = { os: "win32", arch };
      const nativePath = await stageKoffiIntoBundledAgents({
        koffiPackageRoot: adapters,
        glmDir,
        targetPlatform,
      });
      expect(await readFile(nativePath, "utf8")).toBe(`native fixture ${arch}`);
      expect(await readdir(join(glmDir, "node_modules", "koffi", "build", "koffi"))).toEqual([
        `win32_${arch}`,
      ]);
      expect(await readFile(join(glmDir, "node_modules", "koffi", "LICENSE.txt"), "utf8")).toBe(
        "license fixture",
      );
      const agentRequire = createRequire(join(glmDir, "zcode.cjs"));
      expect(agentRequire.resolve("koffi")).toBe(
        await realpath(join(glmDir, "node_modules", "koffi", "index.js")),
      );
      expect(
        await verifyStagedKoffi({ resourcesDir: join(root, "resources"), targetPlatform }),
      ).toEqual([]);
    }
    await rm(join(glmDir, "node_modules", "koffi", "build", "koffi", "win32_x64", "koffi.node"));
    expect(
      await verifyStagedKoffi({
        resourcesDir: join(root, "resources"),
        targetPlatform: { os: "win32", arch: "x64" },
      }),
    ).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("Windows 缺少目标原生模块时不能暂存残缺运行时", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-koffi-missing-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "koffi" }));
    const glmDir = join(root, "glm");
    await expect(
      stageKoffiIntoBundledAgents({
        koffiPackageRoot: root,
        glmDir,
        targetPlatform: { os: "win32", arch: "x64" },
      }),
    ).rejects.toThrow("missing target native addon");
    await expect(access(glmDir)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["x64", "arm64"])("macOS %s 不校验旧 CUA 插件的 Koffi", async (arch) => {
  expect(
    await verifyStagedKoffi({
      resourcesDir: "/unused-koffi-fixture",
      targetPlatform: { os: "darwin", arch },
    }),
  ).toEqual([]);
});
