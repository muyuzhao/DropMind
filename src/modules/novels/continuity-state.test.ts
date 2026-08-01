import { describe, expect, it } from "vitest";
import {
  CONTINUITY_MAX_CHARS,
  analyzeContinuityState,
  buildContinuityStateInstructions,
  validateContinuityState,
} from "./continuity-state";

function state(chapterNumber: number, handoff = "- 从当前动作继续。") {
  return `# 正文连续性状态
<!-- DROPMIND_STATE_THROUGH: ${chapterNumber} -->

截至第${chapterNumber}章。

## 当前时空

- 王府深夜。

## 活跃人物状态与知情差

- 主角：已经拿到密信。

## 未解决线索

- 【F001】【P0】密信已经出现；来源未知；下一章查验。

## 硬事实

- 密信仍由主角保管。

## 下一章交接

${handoff}`;
}

describe("continuity state contract", () => {
  it("accepts the bounded five-section snapshot", () => {
    const analysis = validateContinuityState(state(12), 12);
    expect(analysis.characterCount).toBeLessThan(3_000);
    expect(analysis.sectionItemCounts["下一章交接"]).toBe(1);
  });

  it("requires exactly the five ordered sections", () => {
    expect(() => validateContinuityState(state(12).replace("## 硬事实", "## 故事回顾"), 12)).toThrow("依次且仅包含");
  });

  it("rejects an oversized snapshot and too many handoff items", () => {
    const oversized = state(12).replace("密信仍由主角保管", "事实".repeat(CONTINUITY_MAX_CHARS));
    expect(() => validateContinuityState(oversized, 12)).toThrow("超过5000字符");
    const handoff = Array.from({ length: 7 }, (_, index) => `- 交接${index + 1}。`).join("\n");
    expect(() => validateContinuityState(state(12, handoff), 12)).toThrow("不得超过6条");
  });

  it("warns about long snapshots and exact cross-section duplication", () => {
    const duplicate = "- ".concat("同一事实".repeat(450), "。");
    const content = state(12)
      .replace("- 王府深夜。", duplicate)
      .replace("- 密信仍由主角保管。", duplicate);
    const analysis = analyzeContinuityState(content);
    expect(analysis.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("超过建议值"),
      expect.stringContaining("跨栏目完全重复"),
    ]));
  });

  it("tells chapter generators to rewrite instead of append", () => {
    const instructions = buildContinuityStateInstructions(8);
    expect(instructions).toContain("不是在旧快照末尾追加内容");
    expect(instructions).toContain("未来3章");
    expect(instructions).toContain("绝对不得超过5000字符");
  });
});
