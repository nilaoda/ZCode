import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { maybeThrowStorageFsFault } from "../fs-fault-injection.js";
import { resolveZCodeUserRootDir } from "@zcode/shared/node";

export function getDefaultSessionDbPath(): string {
  return join(resolveZCodeUserRootDir(), "cli", "db", "db.sqlite");
}

export function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    maybeThrowStorageFsFault({ operation: "mkdir", path: parent });
    mkdirSync(parent, { recursive: true });
  }
}
