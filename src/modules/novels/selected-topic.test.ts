import { describe, expect, it } from "vitest";
import { formatSelectedTopic, parseSelectedTopic } from "./selected-topic";

describe("selected topic fields", () => {
  it("parses the legacy reference labels", () => {
    expect(parseSelectedTopic("【参考书名】\n替嫁王妃\n\n【参考简介】\n她替姐出嫁。"))
      .toEqual({ title: "替嫁王妃", summary: "她替姐出嫁。" });
  });

  it("parses the current labels and colon labels", () => {
    expect(parseSelectedTopic("书名：替嫁王妃\n简介：她替姐出嫁。"))
      .toEqual({ title: "替嫁王妃", summary: "她替姐出嫁。" });
    expect(parseSelectedTopic("【书名】\n替嫁王妃\n\n【简介】\n她替姐出嫁。"))
      .toEqual({ title: "替嫁王妃", summary: "她替姐出嫁。" });
  });

  it("falls back to the first line as the title without losing the remainder", () => {
    expect(parseSelectedTopic("替嫁王妃\n她替姐出嫁。\n第二段。"))
      .toEqual({ title: "替嫁王妃", summary: "她替姐出嫁。\n第二段。" });
  });

  it("formats both fields for storage and downstream prompts", () => {
    expect(formatSelectedTopic({ title: " 替嫁王妃 ", summary: " 她替姐出嫁。 " }))
      .toBe("【书名】\n替嫁王妃\n\n【简介】\n她替姐出嫁。");
  });
});
