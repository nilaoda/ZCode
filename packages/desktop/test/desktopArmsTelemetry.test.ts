import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArmsUserIdentitySync } from "../src/main/armsUserIdentity.js";

const { env, sdk } = vi.hoisted(() => {
  const env = { local: false, endpoint: "", initialized: false };
  const requireConfig = () => {
    if (!env.initialized) throw new Error("Config not initialized");
  };
  const sdk = {
    setConfig: vi.fn(function (this: unknown, ..._args: unknown[]) {
      requireConfig();
      return this;
    }),
    getConfig: vi.fn(function (this: unknown) {
      requireConfig();
      return { env: "prod", receiver: this };
    }),
    sendCustom: vi.fn(requireConfig),
    sendEvent: vi.fn(requireConfig),
  };
  return { env, sdk };
});

vi.mock("@arms/rum-electron", () => ({ default: sdk }));
vi.mock("@zcode/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zcode/shared")>()),
  get ZCODE_LOCAL_ONLY_BUILD() {
    return env.local;
  },
  get ZCODE_ARMS_RUM_ENDPOINT() {
    return env.endpoint;
  },
  // ARMS 与数仓的启用条件独立。
  ZCODE_TELEMETRY_ENABLED: false,
}));

describe("Desktop ARMS 关闭边界", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", "false");
    env.local = false;
    env.endpoint = "";
    env.initialized = false;
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it.each(["empty-endpoint", "local-with-endpoint", "product-disabled"] as const)(
    "%s：未初始化 SDK 时身份同步、配置和上报仍可完成",
    async (mode) => {
      env.local = mode === "local-with-endpoint";
      env.endpoint = mode === "empty-endpoint" ? "" : "https://example.test/endpoint";
      vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", mode === "product-disabled" ? "true" : "false");
      const { default: telemetry, desktopArmsTelemetryEnabled } =
        await import("../src/main/desktopArmsTelemetry.js");
      const identity = createArmsUserIdentitySync({
        deviceMid: "test-device",
        setUser: (user) => telemetry.setConfig("user", user),
      });
      expect(() => {
        identity.refresh();
        telemetry.setConfig("properties", { platform: "windows" });
        telemetry.setConfig({ enable: false, endpoint: "" });
        telemetry.sendCustom({ name: "startup", type: "custom", value: 1 });
        telemetry.sendEvent({ event_type: "exception" });
      }).not.toThrow();
      expect(desktopArmsTelemetryEnabled).toBe(false);
      expect(telemetry.getConfig()).toBeUndefined();
      for (const call of Object.values(sdk)) expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(["empty-endpoint", "local-with-endpoint"] as const)(
    "%s：关闭时不注入 perf 脚本、不轮询或改写 preload Bridge",
    async (mode) => {
      env.local = mode === "local-with-endpoint";
      env.endpoint = env.local ? "https://example.test/endpoint" : "";
      vi.useFakeTimers();
      try {
        const { scheduleArmsBrowserPerfLoadNudge } =
          await import("../src/main/armsBrowserPerfLoadNudge.js");
        const { scheduleArmsEventBridgePatch, installArmsRumBridgeIpcForward } =
          await import("../src/shared/armsRumBridgeForward.js");
        const webContents = { on: vi.fn(), executeJavaScript: vi.fn() };
        const send = vi.fn();
        const ipc = { send };
        scheduleArmsBrowserPerfLoadNudge(webContents as never);
        scheduleArmsEventBridgePatch();
        installArmsRumBridgeIpcForward(ipc as never);
        expect(webContents.on).not.toHaveBeenCalled();
        expect(webContents.executeJavaScript).not.toHaveBeenCalled();
        expect(ipc.send).toBe(send);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("非 Local 显式启用时按原参数和 SDK 接收者转发，不依赖数仓开关", async () => {
    env.endpoint = "https://example.test/endpoint";
    env.initialized = true;
    const { default: telemetry, desktopArmsTelemetryEnabled } =
      await import("../src/main/desktopArmsTelemetry.js");
    telemetry.setConfig("user", { name: "test-device" });
    telemetry.setConfig({ enable: true, endpoint: env.endpoint });
    const custom = { name: "startup", type: "custom" as const, value: 1 };
    const exception = { event_type: "exception" };
    telemetry.sendCustom(custom);
    telemetry.sendEvent(exception);
    expect(desktopArmsTelemetryEnabled).toBe(true);
    expect(telemetry.getConfig()).toEqual({ env: "prod", receiver: sdk });
    expect(sdk.setConfig.mock.calls).toEqual([
      ["user", { name: "test-device" }],
      [{ enable: true, endpoint: env.endpoint }],
    ]);
    expect(sdk.sendCustom).toHaveBeenCalledWith(custom);
    expect(sdk.sendEvent).toHaveBeenCalledWith(exception);
    for (const call of Object.values(sdk))
      expect(call.mock.contexts.every((ctx) => ctx === sdk)).toBe(true);
  });

  it("业务模块不能绕过出口直接引入真实 ARMS SDK", async () => {
    const dir = new URL("../src/main/", import.meta.url);
    const files = await readdir(dir, { recursive: true });
    const directImports = await Promise.all(
      files
        .filter((file) => file.endsWith(".ts"))
        .map(async (file) => {
          const source = await readFile(new URL(file, dir), "utf8");
          return /(?:from\s*|import\s*\()["']@arms\/rum-electron["']/.test(source) ? file : null;
        }),
    );
    expect(directImports.filter(Boolean).sort()).toEqual([
      "appARMSBootstrap.ts",
      "desktopArmsTelemetry.ts",
    ]);
  });
});
