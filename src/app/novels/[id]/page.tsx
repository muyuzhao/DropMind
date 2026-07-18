import { notFound } from "next/navigation";
import { NovelWorkspace, type WorkspaceData } from "@/components/novels/novel-workspace";
import { getNovelCodexProjectInfo } from "@/modules/novels/codex-project";
import { novelRepository } from "@/modules/novels/repository";

export default async function NovelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = novelRepository.getNovelWorkspace(id);
  if (!workspace) notFound();
  const schemes=novelRepository.listPromptSchemes().map((scheme)=>({id:String(scheme.id),name:String(scheme.name)}));
  const codexProject=getNovelCodexProjectInfo(workspace);
  return <NovelWorkspace initial={workspace as unknown as WorkspaceData} schemes={schemes} codexProject={codexProject} />;
}
