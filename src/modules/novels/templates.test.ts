import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_TEMPLATES } from "./templates";

describe("ten-chapter prompt templates", () => {
  it("keeps automatic context out of step 4 creative instructions", () => {
    expect(DEFAULT_PROMPT_TEMPLATES.units).not.toContain("{{");
    expect(DEFAULT_PROMPT_TEMPLATES.units).toContain("两个“剧情单元”");
    expect(DEFAULT_PROMPT_TEMPLATES.units).toContain("每个单元包含5章左右");
  });

  it("keeps automatic context out of step 5 creative instructions", () => {
    expect(DEFAULT_PROMPT_TEMPLATES.outlines).not.toContain("{{");
    expect(DEFAULT_PROMPT_TEMPLATES.outlines).toContain("【本章核心】");
    expect(DEFAULT_PROMPT_TEMPLATES.outlines).toContain("心理变化的描写不能少");
  });
});
