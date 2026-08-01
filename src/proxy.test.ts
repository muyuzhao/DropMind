import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("LAN read-only proxy", () => {
  it("keeps the complete workbench available on localhost", () => {
    const response = proxy(new NextRequest("http://0.0.0.0:3000/novels", {
      headers: { host: "localhost:3000" },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows reader pages through a LAN address", () => {
    const response = proxy(new NextRequest("http://192.168.1.4:3000/read/book-1?chapter=2"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects other LAN pages to the reader library", () => {
    const response = proxy(new NextRequest("http://192.168.1.4:3000/novels/book-1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://192.168.1.4:3000/read");
  });

  it("rejects write requests through a LAN address", () => {
    const response = proxy(new NextRequest("http://192.168.1.4:3000/novels/book-1", { method: "POST" }));
    expect(response.status).toBe(403);
  });
});
