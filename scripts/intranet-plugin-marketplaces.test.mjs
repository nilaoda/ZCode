import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMarketplace,
  ensureDefaultPluginMarketplaces,
  updateMarketplace,
  loadMarketplaceManifestSync,
} from "../apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts";
import {
  writeBundledOfficialMarketplacePartitionSync,
  writeCdnOfficialMarketplacePartitionSync,
} from "../apps/zcode-cli/packages/adapters/src/plugins/official-marketplace.ts";

test("内网不创建或刷新公共来源，用户主动添加的来源仍可用", async () => {
  const base = await mkdtemp(join(tmpdir(), "zcode-intranet-market-"));
  const root = join(base, "storage");
  await mkdir(root);
  const previous = process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT;
  const originalFetch = globalThis.fetch;
  process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT = "1";
  globalThis.fetch = async () => {
    throw new Error("Unexpected product request");
  };
  try {
    assert.deepEqual(ensureDefaultPluginMarketplaces(root), []);
    await writeFile(
      join(root, "known_marketplaces.json"),
      JSON.stringify({
        marketplaces: [
          {
            id: "zcode-plugins-official",
            name: "zcode-plugins-official",
            source: { source: "url", url: "https://example.com/marketplace.json" },
            addedAt: "2026-01-01",
            pluginCount: 0,
          },
        ],
      }),
    );
    assert.deepEqual(await updateMarketplace({ storageRoot: root }), []);
    assert.equal(ensureDefaultPluginMarketplaces(root).length, 1);
    const sourceDir = join(base, "source");
    await mkdir(sourceDir);
    const source = join(sourceDir, "company.json");
    await writeFile(
      source,
      JSON.stringify({ name: "company-plugins", owner: { name: "Company" }, plugins: [] }),
    );
    const added = await addMarketplace({
      storageRoot: root,
      source: { source: "file", path: source },
    });
    assert.equal(added.id, "company-plugins");
    assert.equal(loadMarketplaceManifestSync(root, added.id).name, "company-plugins");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT;
    else process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT = previous;
    await rm(base, { recursive: true, force: true });
  }
});

test("旧 CDN 分片不能覆盖内置离线目录或恢复官方云插件", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-intranet-seed-"));
  const previous = process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT;
  process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT = "1";
  try {
    writeCdnOfficialMarketplacePartitionSync({
      storageRoot: root,
      manifest: {
        name: "zcode-plugins-official",
        plugins: [{ name: "image-search", source: "https://example.com/plugin" }],
      },
    });
    const manifest = writeBundledOfficialMarketplacePartitionSync({
      storageRoot: root,
      manifest: {
        name: "zcode-plugins-official",
        plugins: [{ name: "vision-assistant", source: "filesystem" }],
      },
    });
    assert.deepEqual(
      manifest.plugins.map((plugin) => plugin.name),
      ["vision-assistant"],
    );
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT;
    else process.env.ZCODE_DISABLE_PRODUCT_ENDPOINT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
