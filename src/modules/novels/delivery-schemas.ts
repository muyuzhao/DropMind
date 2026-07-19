import { z } from "zod";

const required = z.string().trim().min(1, "此项不能为空");
const fanqieManageUrl = required.url("请输入完整的网址").refine((value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fanqienovel.com" || hostname.endsWith(".fanqienovel.com");
  } catch { return false; }
}, "只支持番茄小说网地址");

export const saveDeliveryTargetSchema = z.object({
  novelId: required,
  bookName: required.max(100, "作品名不能超过100字"),
  manageUrl: fanqieManageUrl,
  defaultVolume: z.string().trim().max(100, "分卷名不能超过100字"),
});

export const queueDeliverySchema = z.object({ novelId: required, chapterNumber: z.number().int().min(1).max(60) });
export const cancelDeliverySchema = z.object({ novelId: required, jobId: required });
export const extensionStatusSchema = z.object({ status: z.enum(["filled", "submitted", "failed"]), error: z.string().max(1000).optional() });
