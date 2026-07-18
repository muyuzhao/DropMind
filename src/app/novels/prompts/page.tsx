import Link from "next/link";
import { novelRepository } from "@/modules/novels/repository";
import { PromptSchemeManager } from "@/components/novels/prompt-scheme-manager";
export const dynamic = "force-dynamic";
export default function Page(){const schemes=novelRepository.listPromptSchemes().map(r=>novelRepository.getPromptScheme(String(r.id))!);return <main className="novel-shell"><Link href="/novels">← 返回</Link><h1>提示词管理</h1><PromptSchemeManager initial={schemes}/></main>}
