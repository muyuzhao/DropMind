import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createItem, listItems } from "@/modules/inbox/service";

export async function GET() {
  return NextResponse.json({ items: await listItems() });
}

export async function POST(request: Request) {
  try {
    const item = await createItem(await request.json());
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "输入无效" }, { status: 400 });
    }
    console.error("Failed to create inbox item", error);
    return NextResponse.json({ error: "保存失败，请稍后重试" }, { status: 500 });
  }
}
