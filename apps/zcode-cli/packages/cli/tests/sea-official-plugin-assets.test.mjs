import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectSeaOfficialPluginAssets } from "../scripts/sea-official-plugin-assets.mjs";

test("includes the document judge agent in official SEA assets", async () => {
  const stagingDirectory = await mkdtemp(join(tmpdir(), "zcode-sea-document-agent-"));
  const root = join(import.meta.dirname, "../../..");

  try {
    const { manifest } = await collectSeaOfficialPluginAssets({
      root,
      stagingDirectory,
    });
    assert.equal(
      manifest.plugins.some((plugin) => plugin.name === "document-skills"),
      false,
    );
    for (const [name, skill] of [
      ["documents", "docx"],
      ["pdf", "pdf"],
      ["presentations", "pptx"],
      ["spreadsheets", "xlsx"],
    ]) {
      const plugin = manifest.plugins.find((plugin) => plugin.name === name);
      assert.ok(plugin, `missing ${name} SEA manifest entry`);
      const sourceManifest = JSON.parse(await readFile(join(root, "packages", name+"-plugin", ".zcode-plugin", "plugin.json"), "utf8"));
      assert.equal(plugin.version, sourceManifest.version);
      for (const path of ["agents/visual-judge.md", `skills/${skill}/SKILL.md`])
        assert.ok(
          plugin.files.some((file) => file.path === path),
          `${name}: ${path}`,
        );
    }
    const creator = manifest.plugins.find((plugin) => plugin.name === "plugin-creator");
    assert.ok(creator, "missing plugin-creator SEA manifest entry");
    for (const path of [
      ".zcode-plugin/plugin.json",
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ])
      assert.ok(
        creator.files.some((file) => file.path === path),
        `missing ${path}`,
      );
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
});

test("rejects an incomplete documents SEA seed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-sea-document-agent-missing-"));
  const root = join(directory, "root");
  const stagingDirectory = join(directory, "staging");

  try {
    const sourceRoot = join(import.meta.dirname, "../../..");
    for (const name of ["vision-assistant", "visualize", "node-repl-host", "browser-use", "documents"]) {
      await cp(join(sourceRoot, "packages", name === "node-repl-host" ? name : name+"-plugin"), join(root, "packages", name === "node-repl-host" ? name : name+"-plugin"), {recursive:true});
    }
    await rm(join(root, "packages/documents-plugin/agents/visual-judge.md"));

    await assert.rejects(
      collectSeaOfficialPluginAssets({ root, stagingDirectory }),
      /Missing documents required seed asset.*agents[/\\]visual-judge\.md/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
