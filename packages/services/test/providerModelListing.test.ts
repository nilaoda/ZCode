import { afterEach, expect, it, vi } from "vitest";
import { fetchProviderModels } from "../src/model-provider/providerModelListing.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["openai-chat-completions", "anthropic-messages"] as const)(
  "Local 保留用户主动获取 %s 模型列表",
  async (apiFormat) => {
    vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
    const request = vi.fn(async () =>
      Response.json({ data: [{ id: "vision-a" }, { id: "text-a" }, { id: "vision-a" }] }),
    );
    vi.stubGlobal("fetch", request);
    expect(
      await fetchProviderModels({
        apiFormat,
        baseUrl: "https://user-model.example/v1/",
        apiKey: "test",
        headers: { "X-Custom-Auth": "user-token" },
      }),
    ).toEqual({ ok: true, models: ["vision-a", "text-a"] });
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://user-model.example/v1/models");
    const headers = new Headers(init.headers);
    expect(headers.get("x-custom-auth")).toBe("user-token");
    expect(headers.get(apiFormat === "anthropic-messages" ? "x-api-key" : "authorization")).toBe(
      apiFormat === "anthropic-messages" ? "test" : "Bearer test",
    );
  },
);
