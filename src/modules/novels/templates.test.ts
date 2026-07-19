import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_TEMPLATES } from "./templates";

describe("ten-chapter prompt templates", () => {
  it("keeps the work tag guide as a complete fixed prompt", () => {
    expect(DEFAULT_PROMPT_TEMPLATES.tags).toContain("📚 作品标签生成指南");
    expect(DEFAULT_PROMPT_TEMPLATES.tags).toContain("主分类：必选，且只能选一个");
    expect(DEFAULT_PROMPT_TEMPLATES.tags).toContain("主角名1：[待填写]");
    expect(DEFAULT_PROMPT_TEMPLATES.tags).toContain("主角名2：[待填写]");
  });

  it("keeps cover creation requirements in an independently managed template", () => {
    expect(DEFAULT_PROMPT_TEMPLATES.cover).toContain("番茄爽文小说封面创作");
    expect(DEFAULT_PROMPT_TEMPLATES.cover).toContain("作者：不想回家的雨滴/著");
    expect(DEFAULT_PROMPT_TEMPLATES.cover).toContain("比例：3：4");
  });

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
