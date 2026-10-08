import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  migrateProjectMemories,
  copyProjectMemoryStorage,
  resolveProjectMemoryCliStorageRoot,
} from "@zcode/shared/node";
import { createMemoryService } from "../src/memory/memoryService.js";
import { copyDataDirectory, setDataBaseDir } from "../src/paths.js";
import { createSystemService } from "../src/system/systemService.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "zcode-memory-storage-"));
  try {
    await run(root);
  } finally {
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
}

const workspace = "example-0123456789abcdef";
const memoryPath = (cli: string) => join(cli, "memories", "projects", workspace, "memory");

test("项目记忆跟随 Host 数据根，独立 CLI 保留 storage.dir", () => {
  assert.equal(resolveProjectMemoryCliStorageRoot("/custom/cli", {}), "/custom/cli");
  assert.equal(
    resolveProjectMemoryCliStorageRoot("/old/cli", { ZCODE_DATA_BASE_DIR: "/profile" }),
    join("/profile", ".zcode", "cli"),
  );
  assert.equal(
    resolveProjectMemoryCliStorageRoot("/old/cli", { ZCODE_DESKTOP_HOME_DIR: "/desktop" }),
    join("/desktop", ".zcode", "cli"),
  );
});

test("并发导入旧记忆保留原件和当前文件，删除后不复活，并随数据目录迁移", async () => {
  await fixture(async (root) => {
    const legacy = join(root, "old", ".zcode", "cli");
    const base = join(root, "current");
    const current = join(base, ".zcode", "cli");
    await mkdir(memoryPath(legacy), { recursive: true });
    await mkdir(memoryPath(current), { recursive: true });
    await writeFile(join(memoryPath(legacy), "MEMORY.md"), "old index");
    await writeFile(join(memoryPath(legacy), "workflow.md"), "旧项目记忆");
    await writeFile(join(memoryPath(current), "MEMORY.md"), "current index");
    await Promise.all([
      migrateProjectMemories(current, [legacy]),
      migrateProjectMemories(current, [legacy]),
    ]);
    assert.equal(await readFile(join(memoryPath(current), "MEMORY.md"), "utf8"), "current index");
    assert.equal(await readFile(join(memoryPath(legacy), "workflow.md"), "utf8"), "旧项目记忆");
    setDataBaseDir(base);
    assert.equal((await createSystemService().info()).dataBaseDir, base);
    const service = createMemoryService({ legacyCliStorageRoots: [legacy] });
    const catalog = await service.listProjectMemories();
    assert.equal(catalog.length, 1);
    assert.deepEqual(
      catalog[0]!.files.map((file) => file.name),
      ["MEMORY.md", "workflow.md"],
    );
    assert.equal(
      (await service.readProjectMemoryFile({ workspaceId: workspace, fileName: "workflow.md" }))
        .content,
      "旧项目记忆",
    );
    await rm(join(memoryPath(current), "workflow.md"));
    await service.listProjectMemories();
    await assert.rejects(readFile(join(memoryPath(current), "workflow.md")), { code: "ENOENT" });
    await mkdir(join(base, ".zcode", "v2"), { recursive: true });
    await writeFile(join(base, ".zcode", "v2", "test.json"), "{}");
    const nextBase = join(root, "next");
    await copyDataDirectory(base, nextBase);
    await writeFile(join(memoryPath(current), "new.md"), "new memory");
    await copyDataDirectory(base, nextBase);
    const next = join(nextBase, ".zcode", "cli");
    await migrateProjectMemories(next, [legacy]);
    assert.equal(await readFile(join(memoryPath(next), "new.md"), "utf8"), "new memory");
    assert.equal(await readFile(join(memoryPath(next), "MEMORY.md"), "utf8"), "current index");
    await assert.rejects(readFile(join(memoryPath(next), "workflow.md")), { code: "ENOENT" });
  });
});

test("来源稍后出现可导入，跳过链接，失败后可重试", async () => {
  await fixture(async (root) => {
    const legacy = join(root, "legacy");
    const current = join(root, "current");
    await migrateProjectMemories(current, [legacy]);
    await mkdir(memoryPath(legacy), { recursive: true });
    await writeFile(join(memoryPath(legacy), "MEMORY.md"), "index");
    await writeFile(join(root, "outside.md"), "outside");
    await symlink(join(root, "outside.md"), join(memoryPath(legacy), "linked.md"));
    await mkdir(join(current, "memories", "projects", workspace), { recursive: true });
    await writeFile(memoryPath(current), "blocked directory");
    await assert.rejects(migrateProjectMemories(current, [legacy]));
    await rm(memoryPath(current));
    await migrateProjectMemories(current, [legacy]);
    assert.equal(await readFile(join(memoryPath(current), "MEMORY.md"), "utf8"), "index");
    await assert.rejects(readFile(join(memoryPath(current), "linked.md")), { code: "ENOENT" });
  });
});

test("拒绝重叠目录和目标链接，避免递归复制或写入目录外", async () => {
  await fixture(async (root) => {
    const legacy = join(root, "legacy");
    const current = join(root, "current");
    await mkdir(memoryPath(legacy), { recursive: true });
    await writeFile(join(memoryPath(legacy), "MEMORY.md"), "index");
    await assert.rejects(
      copyProjectMemoryStorage(legacy, join(memoryPath(legacy), "nested")),
      /overlap/,
    );
    await mkdir(join(current, "memories", "projects"), { recursive: true });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(current, "memories", "projects", workspace));
    await assert.rejects(migrateProjectMemories(current, [legacy]), /regular directory/);
    await assert.rejects(readFile(join(outside, "memory", "MEMORY.md")), { code: "ENOENT" });
  });
});

test("成功标记跨实例生效，之后不访问旧目录或获取迁移锁", async () => {
  await fixture(async (root) => {
    const legacy = join(root, "legacy");
    const current = join(root, "current");
    await mkdir(memoryPath(legacy), { recursive: true });
    await writeFile(join(memoryPath(legacy), "MEMORY.md"), "index");
    await migrateProjectMemories(current, [legacy]);
    await rm(legacy, { recursive: true });
    await symlink(join(root, "missing"), legacy);
    const lock = join(current, "memories", "projects", ".legacy-import.lock");
    await mkdir(lock);
    await writeFile(
      join(lock, "owner-current.json"),
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
    );
    await migrateProjectMemories(current, [legacy]);
    assert.equal(await readFile(join(memoryPath(current), "MEMORY.md"), "utf8"), "index");
  });
});
