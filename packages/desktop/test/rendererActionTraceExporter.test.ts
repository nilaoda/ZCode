import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRendererActionTraceExporter,
  parseRendererActionTraceHeaders,
  resolveRendererActionTraceEndpoint,
} from "../src/main/rendererActionTraceExporter.js";

const { exporterCreated, product } = vi.hoisted(() => ({
  exporterCreated: vi.fn(),
  product: { local: false },
}));
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(options: unknown) {
      exporterCreated(options);
    }
  },
}));
vi.mock("@zcode/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zcode/shared")>()),
  get ZCODE_LOCAL_ONLY_BUILD() {
    return product.local;
  },
}));

describe("renderer action trace exporter config", () => {
  beforeEach(() => {
    product.local = false;
    exporterCreated.mockClear();
  });
  it.each(["local", "product-disabled", "sdk-disabled"] as const)(
    "%s：即使继承系统 OTLP 地址，也不构造 exporter",
    (mode) => {
      product.local = mode === "local";
      const exporter = createRendererActionTraceExporter({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.test/otlp",
        ZCODE_DISABLE_PRODUCT_ENDPOINT: mode === "product-disabled" ? "true" : "false",
        OTEL_SDK_DISABLED: mode === "sdk-disabled" ? " TRUE " : "false",
      });
      expect(exporter).toBeUndefined();
      expect(exporterCreated).not.toHaveBeenCalled();
    },
  );
  it("非 Local 显式启用时保留 endpoint 与认证头解析", () => {
    expect(
      createRendererActionTraceExporter({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.test/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "x-test=hello%20world",
      }),
    ).toBeDefined();
    expect(exporterCreated).toHaveBeenCalledWith({
      url: "https://example.test/otlp/v1/traces",
      headers: { "x-test": "hello world" },
      timeoutMillis: 3000,
    });
  });
  it("uses the traces endpoint directly and appends v1/traces to the common endpoint", () => {
    expect(
      resolveRendererActionTraceEndpoint({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example/custom",
      }),
    ).toBe("https://arms.example/custom");
    expect(
      resolveRendererActionTraceEndpoint({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://arms.example/otlp/",
      }),
    ).toBe("https://arms.example/otlp/v1/traces");
  });

  it("rejects non-http endpoints and parses percent-encoded headers", () => {
    expect(
      resolveRendererActionTraceEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/x" }),
    ).toBeUndefined();
    expect(parseRendererActionTraceHeaders("x-key=hello%20world,ignored,x-two=2")).toEqual({
      "x-key": "hello world",
      "x-two": "2",
    });
  });
});
