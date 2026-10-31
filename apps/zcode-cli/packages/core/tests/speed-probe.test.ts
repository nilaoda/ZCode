import { describe, expect, it } from "vitest";
import {
  buildSpeedProbeUserPrompt,
  computeSpeedProbeMetrics,
} from "../src/runtime/methods/workspace-generate-text.js";

describe("speed probe prompt", () => {
  it("embeds the seed so identical calls never repeat", () => {
    const first = buildSpeedProbeUserPrompt(1_000_000, () => 0.1);
    const second = buildSpeedProbeUserPrompt(2_000_000, () => 0.2);
    expect(first).not.toBe(second);
    expect(first).toContain("128 numbered lines");
    // 同一 now + 同一 random：确定可复现（测试可断言）
    expect(buildSpeedProbeUserPrompt(1_000_000, () => 0.1)).toBe(first);
  });

  it("keeps the fixed instruction frame and picks a seed word", () => {
    const prompt = buildSpeedProbeUserPrompt(42, () => 0.5);
    expect(prompt).toContain("Throughput probe session");
    expect(prompt).toContain('the word "');
    expect(prompt).toContain("No preamble");
    // 回归：seed 与随机词必须是有效 token（曾把 random 函数当数字相乘产出 NaN）
    expect(prompt).toMatch(/session [0-9a-z]+-[0-9a-z]+\./);
    expect(prompt).not.toContain("NaN");
  });
});

describe("computeSpeedProbeMetrics", () => {
  it("computes decode throughput with the decodeWindow formula", () => {
    // startedAt 0 → 首内容 400ms → 结束 2400ms：decode 2000ms，256 tokens
    const metrics = computeSpeedProbeMetrics({
      startedAt: 0,
      firstContentAt: 400,
      finishedAt: 2400,
      outputTokens: 256,
    });
    expect(metrics).toBeDefined();
    expect(metrics!.ttftMs).toBe(400);
    expect(metrics!.decodeMs).toBe(2000);
    expect(metrics!.decodeTps).toBeCloseTo(128, 5);
  });

  it("omits metrics entirely when any timing input is missing", () => {
    expect(
      computeSpeedProbeMetrics({ startedAt: 0, firstContentAt: null, finishedAt: 100, outputTokens: 10 }),
    ).toBeUndefined();
    expect(
      computeSpeedProbeMetrics({ startedAt: 0, firstContentAt: 10, finishedAt: 100, outputTokens: 0 }),
    ).toBeUndefined();
    expect(
      computeSpeedProbeMetrics({ startedAt: 0, firstContentAt: 10, finishedAt: 100, outputTokens: undefined }),
    ).toBeUndefined();
  });

  it("omits metrics when decode window is non-positive", () => {
    expect(
      computeSpeedProbeMetrics({ startedAt: 0, firstContentAt: 100, finishedAt: 100, outputTokens: 5 }),
    ).toBeUndefined();
  });
});
