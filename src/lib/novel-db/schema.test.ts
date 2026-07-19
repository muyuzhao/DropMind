import { describe, expect, it } from "vitest";
import { chapterStatusValues, stepKeyValues } from "./schema";

describe("novel database enums", () => {
  it("keeps the seven workflow keys in order", () => {
    expect(stepKeyValues).toEqual(["topics", "volumes", "settings", "units", "outlines", "tags", "drafts"]);
  });

  it("supports the three chapter states", () => {
    expect(chapterStatusValues).toEqual(["not_started", "saved", "published"]);
  });
});
