import { deliveryRepository } from "@/modules/novels/delivery";
import { extensionStatusSchema } from "@/modules/novels/delivery-schemas";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-DropMind-Token",
  "Access-Control-Allow-Private-Network": "true",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const value = extensionStatusSchema.parse(await request.json());
    const job = deliveryRepository.updateFromExtension(request.headers.get("x-dropmind-token") ?? "", id, value.status, value.error);
    return Response.json({ ok: true, job }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新投递状态失败";
    return Response.json({ ok: false, error: message }, { status: message.includes("令牌") ? 401 : 400, headers: corsHeaders });
  }
}
