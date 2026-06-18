import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getItem, updateItem } from "@/modules/inbox/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const item = await getItem((await context.params).id);
  return item
    ? NextResponse.json({ item })
    : NextResponse.json({ error: "内容不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const item = await updateItem((await context.params).id, await request.json());
    return item
      ? NextResponse.json({ item })
      : NextResponse.json({ error: "内容不存在" }, { status: 404 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "更新参数无效" }, { status: 400 });
    }
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
