import type { StepKey } from "@/lib/novel-db/schema";
import { DEFAULT_PROMPT_TEMPLATES } from "./templates";

export function migrateLegacyBatchTemplate(key: StepKey, template: string) {
  if (key === "units" && template.includes("{{core_settings}}") && template.includes("细分为一个“剧情单元”")) {
    return DEFAULT_PROMPT_TEMPLATES.units;
  }

  if (key === "outlines" && template.includes("{{story_unit}}") && template.includes("每一章严格使用：章节与带梗标题")) {
    return DEFAULT_PROMPT_TEMPLATES.outlines;
  }

  if (key === "units" && template.includes("现在基于第【1】卷的大纲") && template.includes("【1-10】章")) {
    return template
      .replace("【】", "【{{first_volume_outline}}】")
      .replace("【1-10】章", "【{{range_start}}-{{range_end}}】章");
  }

  if (key === "outlines" && template.includes("请根据给你的内容，给我写（第1-10章）")) {
    const migrated = template.replace("第1-10章", "第{{range_start}}-{{range_end}}章");
    return `当前十章剧情单元：\n【{{story_unit}}】\n\n${migrated}`;
  }

  return template;
}
