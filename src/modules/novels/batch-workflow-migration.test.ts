import { describe, expect, it } from "vitest";
import { migrateLegacyBatchTemplate } from "./batch-workflow-migration";

describe("migrateLegacyBatchTemplate", () => {
  it("adds variables to the recognizable legacy unit prompt", () => {
    const legacy = `【】

现在基于第【1】卷的大纲，进行剧情细化。

请将该卷的【1-10】章细分为多个“剧情单元”，每个单元包含5章左右的剧情量。`;
    const migrated = migrateLegacyBatchTemplate("units", legacy);
    expect(migrated).toContain("【{{first_volume_outline}}】");
    expect(migrated).toContain("【{{range_start}}-{{range_end}}】");
  });

  it("adds the current story unit and variables to the recognizable outline prompt", () => {
    const legacy = "请根据给你的内容，给我写（第1-10章），创作极度详细的分章大纲。";
    const migrated = migrateLegacyBatchTemplate("outlines", legacy);
    expect(migrated).toContain("{{story_unit}}");
    expect(migrated).toContain("第{{range_start}}-{{range_end}}章");
  });

  it("leaves unrelated custom templates unchanged", () => {
    expect(migrateLegacyBatchTemplate("units", "我的完全自定义模板")).toBe("我的完全自定义模板");
    expect(migrateLegacyBatchTemplate("outlines", "另一套写法")).toBe("另一套写法");
  });

  it("upgrades recognizable snapshots of the old system templates", () => {
    const oldUnits = "小说核心设定：\n【{{core_settings}}】\n\n第一卷大纲：\n【{{first_volume_outline}}】\n\n现在将第{{range_start}}-{{range_end}}章细分为一个“剧情单元”。";
    const oldOutlines = "第{{range_start}}-{{range_end}}章剧情单元：\n【{{story_unit}}】\n\n每一章严格使用：章节与带梗标题、核心目标。";
    expect(migrateLegacyBatchTemplate("units", oldUnits)).toContain("两个“剧情单元”");
    expect(migrateLegacyBatchTemplate("units", oldUnits)).not.toContain("{{core_settings}}");
    expect(migrateLegacyBatchTemplate("outlines", oldOutlines)).toContain("【本章核心】");
  });
});
