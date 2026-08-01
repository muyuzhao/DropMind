import { NextRequest, NextResponse } from "next/server";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function requestHostname(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.hostname;
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0].toLowerCase();
}

function isReadOnlyPath(pathname: string) {
  return pathname === "/read" || pathname.startsWith("/read/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico";
}

export function proxy(request: NextRequest) {
  const hostname = requestHostname(request);
  if (LOCAL_HOSTNAMES.has(hostname)) return NextResponse.next();

  const isSafeMethod = request.method === "GET" || request.method === "HEAD";
  if (isSafeMethod && isReadOnlyPath(request.nextUrl.pathname)) return NextResponse.next();

  if (isSafeMethod) {
    const readerUrl = request.nextUrl.clone();
    readerUrl.pathname = "/read";
    readerUrl.search = "";
    return NextResponse.redirect(readerUrl);
  }

  return new NextResponse("局域网访问仅支持阅读。", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
