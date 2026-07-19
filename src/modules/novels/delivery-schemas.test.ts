import { describe, expect, it } from "vitest";
import { saveDeliveryTargetSchema } from "./delivery-schemas";

describe("delivery schemas", () => {
  it("accepts Fanqie author URLs", () => {
    expect(saveDeliveryTargetSchema.safeParse({
      novelId: "novel-1",
      bookName: "测试作品",
      manageUrl: "https://fanqienovel.com/main/writer/book-manage",
      defaultVolume: "第一卷",
    }).success).toBe(true);
  });

  it("rejects non-Fanqie URLs", () => {
    const result = saveDeliveryTargetSchema.safeParse({ novelId: "novel-1", bookName: "测试作品", manageUrl: "https://example.com/books", defaultVolume: "" });
    expect(result.success).toBe(false);
  });
});
