import { deliveryRepository } from "@/modules/novels/delivery";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-DropMind-Token",
  "Access-Control-Allow-Private-Network": "true",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    deliveryRepository.verifyConnection(request.headers.get("x-dropmind-token") ?? "");
    return Response.json({ ok: true, service: "DropMind 番茄投递" }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "连接失败" }, { status: 401, headers: corsHeaders });
  }
}
