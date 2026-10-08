import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "./privateFilePersistence.js";
import { resolveUserHomeDir, resolveZCodeUserRootDir } from "./zcodeUserRoot.js";

export function resolveProjectMemoryCliStorageRoot(
  legacyCliStorageRoot: string,
  env: Record<string, string | undefined> = process.env,
): string {
  // Host 的数据根已包含产品身份；项目记忆不能继续按真实 HOME 写入而让查看页读另一处。
  return env.ZCODE_DATA_BASE_DIR?.trim() || env.ZCODE_DESKTOP_HOME_DIR?.trim()
    ? join(resolveZCodeUserRootDir(env), "cli")
    : legacyCliStorageRoot;
}

export function getLegacyProjectMemoryCliStorageRoot(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveUserHomeDir(env), ".zcode", "cli");
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function plainDirectory(path: string, create = false): Promise<boolean> {
  if (create) await mkdir(path, { recursive: true });
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Project Memory directory is not a regular directory: ${path}`);
    }
    return true;
  } catch (error) {
    if (!create && hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function projectsDirectory(cliRoot: string, create = false): Promise<string | undefined> {
  let path = cliRoot;
  for (const segment of ["", "memories", "projects"]) {
    path = join(path, segment);
    if (!(await plainDirectory(path, create))) return undefined;
  }
  return path;
}

async function copyPlainFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
    return;
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  // 先暂存完整快照，再排他复制；不依赖硬链接，兼容外置盘，并避免覆盖并发写入的当前记忆。
  const temporary = join(dirname(targetPath), `.memory-import-${randomUUID()}.tmp`);
  const sourceMetadata = await lstat(sourcePath, { bigint: true });
  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(sourcePath, constants.O_RDONLY | noFollowFlag);
  try {
    const openedMetadata = await handle.stat({ bigint: true });
    if (
      !openedMetadata.isFile() ||
      sourceMetadata.isSymbolicLink() ||
      openedMetadata.dev !== sourceMetadata.dev ||
      openedMetadata.ino !== sourceMetadata.ino
    ) {
      throw new Error("Project Memory source changed during import");
    }
    const content = await handle.readFile();
    const finalMetadata = await handle.stat({ bigint: true });
    if (
      openedMetadata.size !== BigInt(content.length) ||
      openedMetadata.mtimeNs !== finalMetadata.mtimeNs ||
      openedMetadata.ctimeNs !== finalMetadata.ctimeNs ||
      openedMetadata.size !== finalMetadata.size
    ) {
      throw new Error("Project Memory source changed during import");
    }
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    try {
      await copyFile(temporary, targetPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

async function copyMarkdownDirectory(source: string, target: string): Promise<void> {
  await plainDirectory(source);
  await plainDirectory(target, true);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyMarkdownDirectory(sourcePath, targetPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      await copyPlainFile(sourcePath, targetPath);
    }
  }
}

async function copyProjects(sourceProjects: string, targetProjects: string): Promise<void> {
  for (const project of await readdir(sourceProjects, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue;
    const sourceWorkspace = join(sourceProjects, project.name);
    if (!(await plainDirectory(sourceWorkspace))) continue;
    const sourceMemory = join(sourceWorkspace, "memory");
    const memoryMetadata = await lstat(sourceMemory).catch((error: unknown) => {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    });
    if (!memoryMetadata?.isDirectory() || memoryMetadata.isSymbolicLink()) continue;
    const targetMemory = join(targetProjects, project.name, "memory");
    await plainDirectory(dirname(targetMemory), true);
    await copyMarkdownDirectory(sourceMemory, targetMemory);
  }
}

function assertDisjointRoots(source: string, target: string): void {
  const inside = (base: string, path: string) => {
    const suffix = relative(base, path);
    return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
  };
  // 用户选择旧记忆的子目录作为新根时，递归复制会把目标再次当来源，必须在写入前拒绝。
  if (inside(source, target) || inside(target, source)) {
    throw new Error("Project Memory source and target directories overlap");
  }
}

/** 数据目录切换复制当前快照及导入标记，不生成阻止以后再次复制的来源标记。 */
export async function copyProjectMemoryStorage(
  sourceCliRoot: string,
  targetCliRoot: string,
): Promise<void> {
  if (resolve(sourceCliRoot) === resolve(targetCliRoot)) return;
  const sourceProjects = await projectsDirectory(sourceCliRoot);
  if (!sourceProjects) return;
  assertDisjointRoots(sourceProjects, resolve(targetCliRoot, "memories", "projects"));
  const targetProjects = (await projectsDirectory(targetCliRoot, true))!;
  await withFileLock(join(targetProjects, ".legacy-import"), async () => {
    await copyProjects(sourceProjects, targetProjects);
    for (const entry of await readdir(sourceProjects, { withFileTypes: true })) {
      if (entry.isFile() && /^\.legacy-import-[a-f0-9]{64}\.json$/.test(entry.name)) {
        await copyPlainFile(join(sourceProjects, entry.name), join(targetProjects, entry.name));
      }
    }
  });
}

export async function migrateProjectMemories(
  targetCliRoot: string,
  legacyCliRoots: readonly string[],
): Promise<void> {
  const targetRoot = resolve(targetCliRoot);
  for (const legacyCliRoot of new Set(legacyCliRoots.map((root) => resolve(root)))) {
    if (legacyCliRoot === targetRoot) continue;
    const targetProjects = join(targetRoot, "memories", "projects");
    const sourceKey = createHash("sha256").update(legacyCliRoot).digest("hex");
    const marker = join(targetProjects, `.legacy-import-${sourceKey}.json`);
    // 完成标记是跨启动的事实源；成功后不再扫描来源、建目录或竞争迁移锁。
    if (await isMigrationComplete(marker)) continue;
    const sourceProjects = await projectsDirectory(legacyCliRoot);
    if (!sourceProjects) continue;
    assertDisjointRoots(sourceProjects, targetProjects);
    await projectsDirectory(targetRoot, true);
    // 所有来源共用目标锁，避免多个窗口/Agent 同时导入时形成第二条写入路径。
    await withFileLock(join(targetProjects, ".legacy-import"), async () => {
      if (await isMigrationComplete(marker)) return;
      await copyProjects(sourceProjects, targetProjects);
      // 只有全部导入成功才记录完成；缺失来源或失败可重试，成功后删除的文件不会复活。
      await atomicWritePrivateTextFile(marker, '{"version":1}\n');
    });
  }
}

async function isMigrationComplete(marker: string): Promise<boolean> {
  try {
    const metadata = await lstat(marker);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Project Memory import marker is not a regular file");
    }
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
