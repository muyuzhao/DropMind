import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("Fanqie delivery extension formatting", () => {
  function formatter() {
    const context = vm.createContext({ globalThis: {} as Record<string, unknown> });
    const source = fs.readFileSync(path.join(process.cwd(), "browser-extension", "fanqie-delivery", "format.js"), "utf8");
    vm.runInContext(source, context);
    return (context.globalThis as { DropMindDeliveryFormat: { bodyText(value: string): string; bodyHtml(value: string): string } }).DropMindDeliveryFormat;
  }

  it("collapses blank separator lines before native editor insertion", () => {
    expect(formatter().bodyText("第一段。\r\n\r\n第二段。\n \n\n第三段。\n"))
      .toBe("第一段。\n第二段。\n第三段。");
  });

  it("turns blank-line separated prose into paragraphs without empty paragraphs", () => {
    expect(formatter().bodyHtml("第一段。\n\n第二段。\n\n\n第三段。\n"))
      .toBe("<p>第一段。</p><p>第二段。</p><p>第三段。</p>");
  });

  it("keeps a single line break inside one paragraph", () => {
    expect(formatter().bodyHtml("第一行\n第二行")).toBe("<p>第一行<br>第二行</p>");
  });

  it("loads the formatter before the content script", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "browser-extension", "fanqie-delivery", "manifest.json"), "utf8"));
    expect(manifest.content_scripts[0].js).toEqual(["format.js", "content.js"]);
  });
});
