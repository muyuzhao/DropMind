import { notFound } from "next/navigation";
import path from "node:path";
import { NovelWorkspace } from "@/components/novels/novel-workspace";
import { getNovelCodexProjectInfo } from "@/modules/novels/codex-project";
import { deliveryRepository } from "@/modules/novels/delivery";
import { novelRepository } from "@/modules/novels/repository";

export const dynamic = "force-dynamic";

export default async function NovelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = novelRepository.getNovelWorkspace(id);
  if (!workspace) notFound();
  const schemes=novelRepository.listPromptSchemes().map((scheme)=>({id:String(scheme.id),name:String(scheme.name)}));
  const codexProject=getNovelCodexProjectInfo(workspace);
  const delivery=deliveryRepository.getNovelState(id);
  const deliveryExtensionDir=path.join(process.cwd(),"browser-extension","fanqie-delivery");
  return <NovelWorkspace initial={workspace} schemes={schemes} codexProject={codexProject} delivery={delivery} deliveryExtensionDir={deliveryExtensionDir} />;
}
