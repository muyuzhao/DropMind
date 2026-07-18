import { describe, expect, it } from "vitest";
import { renderPrompt } from "./prompts";

describe("renderPrompt", () => {
  it("replaces repeated named fields", () => {
    expect(renderPrompt("《{{title}}》：{{title}}", { title: "测试书" })).toBe("《测试书》：测试书");
  });

  it("reports every missing field", () => {
    expect(() => renderPrompt("{{title}}/{{summary}}", { title: "测试书" })).toThrow("summary");
  });
});
