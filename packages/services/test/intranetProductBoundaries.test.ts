import { FeedbackHttpClient } from "../src/feedback/feedbackHttpClient.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductEndpointDisabled } from "@zcode/shared";
import { createMarketingTouchService } from "../src/marketing-touch/marketingTouchService.js";
import { createHighspeedHttpTransport } from "../src/highspeed/highspeedHttpTransport.js";
import { createCloudContentService } from "../src/cloud-content/cloudContentService.js";
import { createMarketingAssetRegistry } from "../src/marketing-touch/marketingAssetRegistry.js";
import { createNodeApiClient } from "../src/providers/api/nodeApiClient.js";
import {
  createAccountProviderConnectionResolver,
  createCodingPlanFamilyAvailabilityResolver,
  resolveCurrentAccountAccess,
} from "../src/model-provider/accountProviderConnectionResolver.js";
import { createContentBundleCache } from "../src/cloud-content/contentBundleCache.js";

afterEach(() => vi.unstubAllEnvs());

describe("内网产品出口", () => {
  it("账号解析在旧设置、凭据及套餐查询前关闭", async () => {
    vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const resolver = createAccountProviderConnectionResolver({
      readSettings: io,
      loadAccountIdentity: io,
      loadCodingPlanApiKey: io,
      resolveFamilyAvailability: io,
    });
    expect(await resolver({ configuredProviders: {} as never })).toEqual([]);
    const availability = createCodingPlanFamilyAvailabilityResolver({
      apiClient: { request: io },
      credentialService: { load: io },
    });
    expect(await availability({ family: "zai", providers: [], selections: {} })).toEqual({});
    expect(
      await resolveCurrentAccountAccess({
        access: {} as never,
        readSettings: io,
        loadAccountIdentity: io,
      }),
    ).toBeNull();
    expect(io).not.toHaveBeenCalled();
  });

  it("产品 API 覆盖 OAuth 和商业域名，普通用户 URL 保持可用", async () => {
    vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "https://product-mirror.example");
    const io = vi.fn(async () => new Response("{}"));
    const client = createNodeApiClient({ fetchImpl: io });
    for (const origin of [
      "https://zcode.z.ai",
      "https://chat.z.ai",
      "https://bigmodel.cn",
      "https://api.z.ai",
      "https://product-mirror.example",
    ]) {
      await expect(client.request(`${origin}/api/test`)).rejects.toThrow(
        "已禁用指向 ZCode 产品 Endpoint",
      );
    }
    expect(io).not.toHaveBeenCalled();
    await expect(client.request("https://user.example.com/resource")).resolves.toBeInstanceOf(
      Response,
    );
    expect(io).toHaveBeenCalledOnce();
  });

  it("反馈客户端在凭据及网络 IO 前拒绝官方请求", async () => {
    vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const client = new FeedbackHttpClient({
      baseUrl: "https://example.com",
      apiClient: { request: io },
      getAuthHeaders: io,
    });
    await expect(client.list()).rejects.toThrow("Feedback is disabled");
    expect(io).not.toHaveBeenCalled();
  });
  it("Local 身份不能被产品开关关闭值覆盖", () => {
    expect(
      isProductEndpointDisabled({ ZCODE_LOCAL_IDENTITY: "1", ZCODE_DISABLE_PRODUCT_ENDPOINT: "0" }),
    ).toBe(true);
    expect(isProductEndpointDisabled({ ZCODE_DISABLE_PRODUCT_ENDPOINT: "0" })).toBe(false);
  });

  it("营销查询和上报在凭据及网络 IO 前短路", async () => {
    vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", "1");
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const service = createMarketingTouchService({
      apiClient: { request: io } as never,
      getToken: io,
      getDeviceMid: io,
      baseUrl: "https://example.com",
      appVersion: "3.15.1",
    });
    const snapshot = await service.query({ locale: "zh-CN" });
    expect(snapshot.deliveries).toEqual([]);
    await service.report({
      locale: "zh-CN",
      scope: snapshot.scope,
      campaignId: "test",
      actionType: "confirm",
    });
    expect(io).not.toHaveBeenCalled();
  });

  it("官方加速不准备认证也不请求网络", async () => {
    vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", "1");
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const transport = createHighspeedHttpTransport({
      drawUrl: "https://example.com/draw",
      healthyBaseUrl: "https://example.com/",
      drawHeaders: io,
      healthyHeaders: io,
      fetchImpl: io,
      logger: { warn: vi.fn() },
    });
    await expect(transport.draw({} as never)).rejects.toThrow("Highspeed is disabled");
    await expect(transport.healthy("card")).rejects.toThrow("Highspeed is disabled");
    expect(io).not.toHaveBeenCalled();
  });

  it("旧营销资产不能通过媒体 service 或直接 registry 触发 IO", async () => {
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const registry = createMarketingAssetRegistry({ fetch: io });
    const asset = { src: "https://example.com/asset.png", sha256: "a".repeat(64) };
    registry.allow(asset);
    const readMedia = vi.spyOn(registry, "readMedia");
    const service = createCloudContentService({
      cacheRoot: "/unused-intranet-media",
      publishedAssets: registry,
    });
    vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
    await expect(service.readPublishedMedia({ asset, kind: "image" })).rejects.toThrow(
      "cloud_content_disabled",
    );
    expect(readMedia).not.toHaveBeenCalled();
    for (const kind of ["image", "video"] as const) {
      await expect(registry.readMedia(asset, kind)).rejects.toThrow("marketing_asset_disabled");
    }
    expect(io).not.toHaveBeenCalled();
    await service.disposeAllAndWait();
  });

  it("云内容 service 和直接缓存调用都不能下载", async () => {
    vi.stubEnv("ZCODE_DISABLE_PRODUCT_ENDPOINT", "1");
    const io = vi.fn(() => {
      throw new Error("unexpected IO");
    });
    const options = { cacheRoot: "/unused-intranet-test", isTrustedUrl: io, fetch: io };
    const service = createCloudContentService(options);
    const cache = createContentBundleCache(options);
    await expect(service.prepare({ bundle: {} as never })).rejects.toThrow(
      "Cloud content is disabled",
    );
    await expect(cache.acquire({} as never)).rejects.toThrow("Cloud content is disabled");
    expect(io).not.toHaveBeenCalled();
    await service.disposeAllAndWait();
  });
});
