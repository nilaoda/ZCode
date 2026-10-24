import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { maybeThrowStorageFsFault } from "../fs-fault-injection.js";
import { resolveZCodeUserRootDir } from "@zcode/shared/node";

export function getDefaultSessionDbPath(): string {
  return join(resolveZCodeUserRootDir(), "cli", "db", "db.sqlite");
}
