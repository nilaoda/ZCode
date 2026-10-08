import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

// 使用系统 Chrome，不下载浏览器或调用付费模型。fixture 只替换 Host IO，复用真实设置组件和附件 owner。
test("视觉设置共享配置、过滤模型、逐图提交及撤回恢复，兼容手机宽度", async () => {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("./vision-assistant-fixture", import.meta.url)),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } },
  });
  await server.listen();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.resolvedUrls!.local[0]);
    const toggle = page.getByRole("switch", { name: "启用视觉助手" });
    await toggle.waitFor();
    const backup = page.getByRole("combobox", { name: "备用视觉模型" });
    await backup.click();
    await page.getByRole("option", { name: "vision-a · Example", exact: true }).waitFor();
    assert.equal(await page.getByRole("option", { name: /text-model/ }).count(), 0);
    await page.getByRole("option", { name: "vision-a · Example", exact: true }).click();
    assert.equal(await page.getByText(/请先打开一个工作区/).count(), 0);
    await page.getByRole("button", { name: "Remote project" }).click();
    await backup.getByText("vision-a · Example", { exact: true }).waitFor();
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false",
    );
    await toggle.click();
    await page.getByRole("button", { name: "Model settings" }).click();
    await page.getByRole("button", { name: "Plugin details" }).click();
    await backup.getByText("vision-a · Example", { exact: true }).waitFor();
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false",
    );
    await page.getByRole("button", { name: "Model settings" }).click();
    await backup.getByText("vision-a · Example", { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false",
    );
    await toggle.click();
    await page.getByRole("button", { name: "Add images" }).click();
    const images = page.getByRole("combobox", { name: "本次识图模型" });
    assert.equal(await images.count(), 2);
    await images.nth(0).click();
    await page.getByRole("option", { name: "vision-b · Example", exact: true }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="sent-attachments"]')?.textContent?.includes("vision-b"),
    );
    const sent = JSON.parse((await page.getByTestId("sent-attachments").textContent())!);
    assert.equal(sent[0].visionModel.modelId, "vision-b");
    assert.equal(sent[1].visionModel, undefined);
    assert.equal(await images.count(), 0);
    await page.getByRole("button", { name: "Withdraw" }).click();
    await images.nth(0).getByText("vision-b · Example", { exact: true }).waitFor();
    await images.nth(0).click();
    await page.getByRole("option", { name: "自动识图", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="image-choice"]').length === 0,
    );
    const auto = JSON.parse((await page.getByTestId("sent-attachments").textContent())!);
    assert.equal(auto[0].visionModel, undefined);
    const globalCalls = JSON.parse(
      (await page.getByTestId("configuration-calls").textContent())!,
    ).filter((input) => !input.workspacePath);
    assert.ok(globalCalls.some((input) => input.configScope === "user"));
    assert.ok(globalCalls.some((input) => input.scope === "user" && input.enabled === false));
    assert.ok(globalCalls.every((input) => !input.workspaceIdentity && !input.remoteSessionId));

    await page.getByRole("button", { name: "Add vision model", exact: true }).click();
    await backup.click();
    await page.getByRole("option", { name: "vision-c · Example", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete vision model", exact: true }).click();
    await backup.click();
    assert.equal(
      await page.getByRole("option", { name: "vision-c · Example", exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete all vision models", exact: true }).click();
    await page
      .getByText("没有可用的视觉模型，助手已关闭。请先添加并启用支持图片的模型。", { exact: true })
      .waitFor();
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    assert.equal(await toggle.isDisabled(), true);
    await page.getByRole("button", { name: "Add vision model", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[role="switch"]')?.hasAttribute("disabled"),
    );
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await page.getByRole("button", { name: "Plugin details" }).click();
    await page.waitForFunction(
      () => !document.querySelector('[role="switch"]')?.hasAttribute("disabled"),
    );
    assert.equal(await toggle.getAttribute("aria-checked"), "false");

    await page.goto(`${server.resolvedUrls!.local[0]}?scenario=error`);
    await page.getByRole("alert").getByText("Fixture plugin read failed").waitFor();
    assert.equal(await page.getByText(/请先打开一个工作区/).count(), 0);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[role="switch"]')?.hasAttribute("disabled"),
    );
    await page.goto(`${server.resolvedUrls!.local[0]}?scenario=missing`);
    await page
      .getByText("视觉助手插件未安装，请在插件管理中恢复内置插件。", { exact: true })
      .waitFor();
    assert.equal(await page.getByRole("switch").isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
