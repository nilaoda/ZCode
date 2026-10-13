import { afterEach, expect, it, vi } from "vitest";
import { preparePluginSandboxSession } from "../src/main/pluginSandbox/session.js";
import { createPluginSandboxRegistry } from "../src/main/pluginSandbox/registry.js";

const guest = vi.hoisted(() => ({ getURL: vi.fn() }));
vi.mock("electron", () => ({ webContents: { fromId: () => guest } }));
afterEach(() => vi.unstubAllEnvs());

it("Local Gen UI redirects bundled scripts and blocks every CDN fallback while configured MCP resources remain available", async () => {
  vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", "1");
  const registry = createPluginSandboxRegistry();
  const instance = { runtimeId: "test", generation: 1, token: "test", appIdentity: "a".repeat(64) };
  const genUi = registry.register({
    instance,
    ownerWebContentsId: 1,
    workspacePath: "/work",
    sessionId: "s",
    scopeId: "gen",
    html: "",
    contentKind: "gen-ui",
  });
  const mcp = registry.register({
    instance: { ...instance, token: "mcp" },
    ownerWebContentsId: 1,
    sessionId: "s",
    scopeId: "mcp",
    html: "",
    pluginId: "user-plugin",
    serverName: "user-mcp",
  });
  let beforeRequest: (details: unknown, callback: (result: unknown) => void) => void;
  preparePluginSandboxSession({
    registry,
    session: {
      protocol: { handle: vi.fn() },
      webRequest: {
        onBeforeRequest: (_filter: unknown, handler: typeof beforeRequest) => {
          beforeRequest = handler;
        },
      },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
      setProxy: async () => {},
    } as never,
    assets: {
      rendererDir: "/unused",
      aliasDir: new URL(
        "../../../apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/",
        import.meta.url,
      ).pathname,
    },
  });
  const request = (url: string, resourceType = "script") =>
    new Promise<unknown>((resolve) =>
      beforeRequest({ url, resourceType, webContentsId: 1 }, resolve),
    );
  const pinned = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";
  guest.getURL.mockReturnValue(genUi.shellUrl);
  expect(await request(pinned)).toEqual({
    redirectURL: expect.stringContaining("/__zcode__/vendor/d3-7.9.0.min.js"),
  });
  expect(await request(pinned + "?unbundled=1")).toEqual({ cancel: true });
  expect(await request("https://example.com/image.png", "image")).toEqual({ cancel: true });
  expect(await request("http://example.com/script.js")).toEqual({ cancel: true });
  guest.getURL.mockReturnValue(mcp.shellUrl);
  expect(await request("https://example.com/user-resource.png", "image")).toEqual({});
});
