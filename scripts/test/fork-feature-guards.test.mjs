import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

// 上游整文件替换会静默丢掉 fork 独有改动。这些断言只钉住「功能还在」的
// 最小标记，不锁实现细节；确实要改功能时同步改断言即可。

test("fork: 思考中的实时速度保留最终实现（3s 刷新 + 切会话基线）", async () => {
  const source = await read("packages/ui/src/components/ai-elements/reasoning.tsx");
  for (const marker of [
    "LiveReasoningSpeed",
    "LIVE_SPEED_REFRESH_MS = 3000",
    "baselineTokens",
    "chat.reasoning.liveTokensPerSecond",
  ]) {
    assert.ok(source.includes(marker), `reasoning.tsx 缺少 ${marker}`);
  }
  for (const locale of ["zh-CN", "en-US", "ja-JP", "ko-KR", "ru-RU"]) {
    const messages = await read(`packages/ui/src/i18n/locales/${locale}.ts`);
    assert.ok(
      messages.includes("chat.reasoning.liveTokensPerSecond"),
      `${locale} 缺少实时速度文案`,
    );
  }
});

test("fork: 不创建 OAuth provider adapter，且登录入口 fail-closed", async () => {
  const providers = await read("packages/services/src/oauth/providers/index.ts");
  assert.ok(providers.includes("外部登录服务已整体移除"));
  assert.ok(providers.includes("return [];"));
  const service = await read("packages/services/src/oauth/oauthService.ts");
  assert.ok(service.includes("Login is disabled in Local builds"));
});

test("fork: 反馈客户端保留 Local 出网闸门", async () => {
  const source = await read("packages/services/src/feedback/feedbackHttpClient.ts");
  assert.ok(source.includes("isProductEndpointDisabled()"));
  assert.ok(source.includes("Feedback is disabled in Local builds"));
});

test("fork: 设置页不出现无效的自动更新开关", async () => {
  const helpers = await read("packages/ui/src/settingsPageHelpers.tsx");
  assert.ok(!helpers.includes("settings.receivePreviewUpdates"));
  assert.ok(!helpers.includes("settings.autoDownloadAndInstallUpdates"));
  const searchIndex = await read("packages/ui/src/settings-search/settingsSearchIndex.ts");
  assert.ok(!searchIndex.includes("settings.receivePreviewUpdates"));
  assert.ok(!searchIndex.includes("settings.autoDownloadAndInstallUpdates"));
});

test("fork: Local 构建隐藏分享管理分区", async () => {
  const source = await read("packages/ui/src/lib/settingsNavigation.ts");
  assert.ok(source.includes('ZCODE_LOCAL_ONLY_BUILD && section === "shares"'));
});

test("fork: Web 构建与桌面共用 Local 档位", async () => {
  const viteConfig = await read("packages/web/vite.config.ts");
  assert.ok(viteConfig.includes("__ZCODE_PRODUCT_FLAVOR__"));
  const buildScript = await read("scripts/build-zcode.mjs");
  assert.ok(buildScript.includes('ZCODE_LOCAL_IDENTITY: "1"'));
});

test("fork: CLI 登录命令与 Web 远控登录路由在 Local 构建关闭", async () => {
  const cliBuild = await read("apps/zcode-cli/packages/cli/scripts/build.mjs");
  assert.ok(cliBuild.includes('__ZCODE_PRODUCT_FLAVOR__: JSON.stringify("local")'));
  for (const file of [
    "apps/zcode-cli/packages/cli/src/login-command.ts",
    "apps/zcode-cli/packages/cli/src/command-center/create.ts",
    "apps/zcode-cli/packages/bootstrap/src/auth-login.ts",
  ]) {
    assert.ok((await read(file)).includes("ZCODE_LOCAL_ONLY_BUILD"), `${file} 缺少 Local 登录门禁`);
  }
  const webMain = await read("packages/web/src/main.tsx");
  assert.ok(webMain.includes("ZCODE_LOCAL_ONLY_BUILD"));
  assert.ok(webMain.includes('window.location.replace("/")'));
});

test("fork: 视觉助手保持默认关闭", async () => {
  const definitions = await read(
    "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
  );
  const visionBlock = definitions.match(/name: "vision-assistant"[\s\S]{0,500}/u)?.[0] ?? "";
  assert.ok(visionBlock.length > 0, "官方插件定义缺少 vision-assistant");
  assert.ok(!visionBlock.includes("defaultEnabled: true"), "视觉助手不应默认启用");
  const marketplaces = await read("packages/shared/src/plugin-marketplaces.ts");
  assert.ok(!marketplaces.includes("vision-assistant@zcode-plugins-official"));
});
