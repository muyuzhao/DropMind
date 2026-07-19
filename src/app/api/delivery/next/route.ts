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
    const job = deliveryRepository.claimNext(request.headers.get("x-dropmind-token") ?? "");
    return Response.json({ ok: true, job }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "领取投递任务失败";
    return Response.json({ ok: false, error: message }, { status: message.includes("令牌") ? 401 : 400, headers: corsHeaders });
  }
}
