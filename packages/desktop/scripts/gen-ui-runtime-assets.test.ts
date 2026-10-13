import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { copyGenUiRuntimeAssets } from "./gen-ui-runtime-assets.mjs";

it("packages the same pinned runtime assets used by standalone export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gen-ui-assets-"));
  const source = new URL(
    "../../../apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/",
    import.meta.url,
  );
  const manifest = JSON.parse(await readFile(new URL("runtime-manifest.json", source), "utf8"));
  try {
    // 清单只承载当前资源的完整性数据，避免把无关的构建元数据带入分发包。
    expect(Object.keys(manifest)).toEqual(["files"]);
    expect(Object.keys(manifest.files).sort()).toEqual([
      "calendar.js",
      "tweak.js",
      "visualize.css",
      "visualize.html",
    ]);
    for (const entry of Object.values(manifest.files)) {
      expect(Object.keys(entry as object)).toEqual(["sha256"]);
    }
    await copyGenUiRuntimeAssets(directory);
    const vendors = JSON.parse(await readFile(join(directory, "vendor/manifest.json"), "utf8"));
    for (const resource of vendors.resources) {
      for (const [file, hash] of [
        [resource.file, resource.sha256],
        [resource.licenseFile, resource.licenseSha256],
      ]) {
        const bytes = await readFile(join(directory, "vendor", file));
        expect(bytes).toEqual(await readFile(new URL(`vendor/${file}`, source)));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
      }
    }
    for (const file of ["visualize.css", "visualize.html", "calendar.js"]) {
      const bytes = await readFile(join(directory, file));
      expect(bytes).toEqual(await readFile(new URL(file, source)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.files[file].sha256);
    }
    const tweak = await readFile(
      new URL("../src/renderer/src/plugin-sandbox/genUiTweakRuntime.js", import.meta.url),
    );
    expect(createHash("sha256").update(tweak).digest("hex")).toBe(
      manifest.files["tweak.js"].sha256,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("Windows Git 检出保持离线资源与运行时的原始摘要", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gen-ui-checkout-"));
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const assetsPath = "apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets";
  const tweakPath = "packages/desktop/src/renderer/src/plugin-sandbox/genUiTweakRuntime.js";
  const git = promisify(execFile);
  try {
    await cp(join(repoRoot, ".gitattributes"), join(directory, ".gitattributes"));
    for (const relative of [assetsPath, tweakPath]) {
      await mkdir(join(directory, relative, ".."), { recursive: true });
      await cp(join(repoRoot, relative), join(directory, relative), { recursive: true });
    }
    await git("git", ["init", "--quiet", directory]);
    await git("git", ["-c", "core.autocrlf=true", "add", "."], { cwd: directory });
    const checkout = join(directory, "checkout");
    await git(
      "git",
      ["-c", "core.autocrlf=true", "checkout-index", "--all", `--prefix=${checkout}/`],
      {
        cwd: directory,
      },
    );
    const assets = join(checkout, assetsPath);
    const manifest = JSON.parse(await readFile(join(assets, "runtime-manifest.json"), "utf8"));
    const vendor = JSON.parse(await readFile(join(assets, "vendor/manifest.json"), "utf8"));
    const files = Object.entries(manifest.files).map(([file, entry]) => [
      file === "tweak.js" ? join(checkout, tweakPath) : join(assets, file),
      (entry as { sha256: string }).sha256,
    ]);
    for (const resource of vendor.resources) {
      files.push([join(assets, "vendor", resource.file), resource.sha256]);
      files.push([join(assets, "vendor", resource.licenseFile), resource.licenseSha256]);
    }
    for (const [file, hash] of files) {
      const bytes = await readFile(resolve(file));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(hash);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
