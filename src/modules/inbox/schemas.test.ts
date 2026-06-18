import { describe, expect, it } from "vitest";
import { createItemSchema, updateItemSchema } from "./schemas";

describe("inbox input schemas", () => {
  it("trims and accepts useful content", () => {
    expect(createItemSchema.parse({ rawContent: "  一个稍纵即逝的想法  " })).toEqual({ rawContent: "一个稍纵即逝的想法" });
  });

  it("rejects empty content", () => {
    expect(() => createItemSchema.parse({ rawContent: "   " })).toThrow("请输入要保存的内容");
  });

  it("only accepts supported item updates", () => {
    expect(updateItemSchema.parse({ status: "archived", isFavorite: true })).toEqual({ status: "archived", isFavorite: true });
    expect(() => updateItemSchema.parse({ status: "deleted" })).toThrow();
  });
});
