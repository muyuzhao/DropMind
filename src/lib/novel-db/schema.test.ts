import { describe, expect, it } from "vitest";
import { chapterStatusValues, stepKeyValues } from "./schema";

describe("novel database enums", () => {
  it("keeps the six workflow keys in order", () => {
    expect(stepKeyValues).toEqual(["topics", "volumes", "settings", "units", "outlines", "drafts"]);
  });

  it("supports the three chapter states", () => {
    expect(chapterStatusValues).toEqual(["not_started", "saved", "published"]);
  });
});
