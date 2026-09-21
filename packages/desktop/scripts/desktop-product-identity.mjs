/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `ZCode Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

/**
 * 构建期开关：为真时安装包使用 Local 身份（自建 / 纯本地模型发行版）。
 *
 * 与 Preview 的差别不只是名字。Preview 按上游设计**有意与正式版共享**任务、配置和凭据
 * （见 `desktopRuntimeEnv.ts` 的注释），只隔离 Electron 自身的状态目录；Local 身份在此之上
 * 额外把**业务数据根**默认切到独立目录，使安装后无需任何环境变量即可与官方版完全隔离。
 *
 * 典型用法：`ZCODE_ENV=production ZCODE_LOCAL_IDENTITY=1`。
 */
export const ZCODE_LOCAL_IDENTITY_ENV = "ZCODE_LOCAL_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.zcode.app",
  productName: "ZCode",
  linuxExecutableName: "zcode",
  linuxPackageName: "zcode",
  cuaHelperInstallVariant: null,
  // 官方版沿用 $HOME，业务数据落在 ~/.zcode。
  dataBaseDirName: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.zcode.app.preview",
  productName: "ZCode Preview",
  linuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode-preview",
  cuaHelperInstallVariant: "preview",
  // Preview 有意与正式版共享业务数据根，这里必须保持 null。
  dataBaseDirName: null,
});

const LOCAL_IDENTITY = Object.freeze({
  flavor: "local",
  appId: "dev.zcode.app.local",
  productName: "ZCode Local",
  linuxExecutableName: "zcode-local",
  linuxPackageName: "zcode-local",
  cuaHelperInstallVariant: "local",
  // 独立数据根：`<home>/.zcode-local-home`，业务数据落在其下的 .zcode/。
  // 命名沿用仓库既有的 ~/.zcode-dev-home 约定，一眼能看出是"另一套数据"。
  dataBaseDirName: ".zcode-local-home",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
  local: LOCAL_IDENTITY,
});

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 身份开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_XXX_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
function readIdentitySwitch(env, envKey) {
  const value = env[envKey]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(`invalid ${envKey}=${env[envKey]}; expected 1 or 0`);
}

export function isPreviewIdentityRequested(env = process.env) {
  return readIdentitySwitch(env, ZCODE_PREVIEW_IDENTITY_ENV);
}

export function isLocalIdentityRequested(env = process.env) {
  return readIdentitySwitch(env, ZCODE_LOCAL_IDENTITY_ENV);
}

/**
 * 产品身份（flavor）与后端环境（`ZCODE_ENV`）是两个轴：
 * - `ZCODE_ENV=test` 一律是 Preview，测试后端不能顶着正式 `ZCode` 身份覆盖用户的正式安装；
 * - `ZCODE_ENV=production` 默认是正式身份，显式身份开关时改用 Preview / Local；
 * - 两个开关同时开启属于配置冲突，取隔离更彻底的 Local。
 * 未知 `ZCODE_ENV` 继续按 test 处理，和共享层 normalizeZCodeEnv 的 fail-safe 默认值一致。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  if (isLocalIdentityRequested(env)) {
    return "local";
  }
  if (isPreviewIdentityRequested(env)) {
    return "preview";
  }
  return normalizeDesktopZCodeEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview / Local 包靠 productName 前缀与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式 / Preview / Local 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "cn.aminer.zcode";
  }
  // 身份表里有对应条目就直接取；未知 flavor 回退正式身份，保持原有 fail-safe 语义。
  return (desktopProductIdentities[flavor] ?? PRODUCTION_IDENTITY).appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}
