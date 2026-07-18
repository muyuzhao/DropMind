import Link from "next/link";
import { NewNovelForm } from "@/components/novels/new-novel-form";
import { novelRepository } from "@/modules/novels/repository";

export default function NewNovelPage() {
  const schemes=novelRepository.listPromptSchemes();
  return <main className="novel-shell novel-narrow"><Link className="novel-back" href="/novels">← 返回小说列表</Link><h1>新建小说</h1><p>填写你找到的爆款书名和简介，工作台会自动装入第一套提示词。</p><NewNovelForm schemes={schemes.map(s=>({id:String(s.id),name:String(s.name),isDefault:Boolean(s.isDefault)}))} /></main>;
}
