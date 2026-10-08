import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import {
  TID_SETTINGS_DATA_BASE_DIR_INPUT,
  TID_SETTINGS_DATA_BASE_DIR_BROWSE,
  TID_SETTINGS_DATA_BASE_DIR_SAVE,
} from "@zcode/shared";

// 复用真实组件和系统 Chrome，只替换目录选择与保存 IO；不下载浏览器。
test("数据目录展示 Host profile，浏览后才保存，返回 profile 时不提交空值", async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("./data-base-dir-fixture", import.meta.url)),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
    },
  });
  await server.listen();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(server.resolvedUrls!.local[0]);
    const input = page.getByTestId(TID_SETTINGS_DATA_BASE_DIR_INPUT);
    await input.waitFor();
    assert.equal(await input.inputValue(), "/profile/.zcode-local-home");
    const save = page.getByTestId(TID_SETTINGS_DATA_BASE_DIR_SAVE);
    assert.equal(await save.isDisabled(), true);
    await page.getByTestId(TID_SETTINGS_DATA_BASE_DIR_BROWSE).click();
    assert.equal(await page.getByTestId("saved-directory").textContent(), "");
    await save.click();
    await page
      .getByTestId("saved-directory")
      .getByText("/selected/data", { exact: true })
      .waitFor();
    await page.getByTestId(TID_SETTINGS_DATA_BASE_DIR_BROWSE).click();
    await save.click();
    await page
      .getByTestId("saved-directory")
      .getByText("/profile/.zcode-local-home", { exact: true })
      .waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});
