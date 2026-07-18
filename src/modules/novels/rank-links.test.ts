import { describe, expect, it } from "vitest";
import { NOVEL_RANK_LINKS } from "./rank-links";

describe("NOVEL_RANK_LINKS", () => {
  it("contains the official rank and trend tracker", () => {
    expect(NOVEL_RANK_LINKS.map((item) => item.href)).toEqual([
      "https://fanqienovel.com/rank",
      "https://fanqietools.com/?tab=trend",
    ]);
  });
});
