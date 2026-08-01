export const CONTINUITY_TARGET_CHARS = 3_000;
export const CONTINUITY_WARNING_CHARS = 3_500;
export const CONTINUITY_MAX_CHARS = 5_000;

export const CONTINUITY_SECTIONS = [
  "当前时空",
  "活跃人物状态与知情差",
  "未解决线索",
  "硬事实",
  "下一章交接",
] as const;

export type ContinuitySection = (typeof CONTINUITY_SECTIONS)[number];

export type ContinuityStateAnalysis = {
  characterCount: number;
  sectionItemCounts: Record<ContinuitySection, number>;
  duplicateItems: string[];
  warnings: string[];
};

function normalizedLines(content: string) {
  return content.replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n").trim().split("\n");
}

function normalizeItem(line: string) {
  return line.replace(/^\s*[-*+]\s+/u, "").replace(/\s+/gu, " ").trim();
}

export function analyzeContinuityState(content: string): ContinuityStateAnalysis {
  const normalized = content.replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n").trim();
  const lines = normalized ? normalized.split("\n") : [];
  const sectionItemCounts = Object.fromEntries(CONTINUITY_SECTIONS.map((section) => [section, 0])) as Record<ContinuitySection, number>;
  const itemSections = new Map<string, Set<string>>();
  let currentSection: string | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/u)?.[1];
    if (heading) {
      currentSection = heading;
      continue;
    }
    if (!currentSection || !/^\s*[-*+]\s+/u.test(line)) continue;
    if ((CONTINUITY_SECTIONS as readonly string[]).includes(currentSection)) {
      sectionItemCounts[currentSection as ContinuitySection] += 1;
    }
    const item = normalizeItem(line);
    if (!item) continue;
    const sections = itemSections.get(item) ?? new Set<string>();
    sections.add(currentSection);
    itemSections.set(item, sections);
  }

  const duplicateItems = [...itemSections.entries()]
    .filter(([, sections]) => sections.size > 1)
    .map(([item]) => item);
  const warnings: string[] = [];
  if (normalized.length > CONTINUITY_WARNING_CHARS) {
    warnings.push(`连续性状态共${normalized.length}字符，超过建议值${CONTINUITY_WARNING_CHARS}，后续章节应主动压缩`);
  }
  if (duplicateItems.length) warnings.push(`检测到${duplicateItems.length}条跨栏目完全重复的事实`);
  return { characterCount: normalized.length, sectionItemCounts, duplicateItems, warnings };
}

export function validateContinuityState(content: string, chapterNumber: number) {
  const lines = normalizedLines(content);
  if (lines[0] !== "# 正文连续性状态") throw new Error("连续性状态标题无效");
  if (lines[1] !== `<!-- DROPMIND_STATE_THROUGH: ${chapterNumber} -->`) throw new Error("连续性状态未在第二行标明正确章节");
  if (!content.includes(`截至第${chapterNumber}章`)) throw new Error(`连续性状态未明确写出“截至第${chapterNumber}章”`);
  if (content.replace(/^\uFEFF/u, "").trim().length > CONTINUITY_MAX_CHARS) {
    throw new Error(`连续性状态超过${CONTINUITY_MAX_CHARS}字符`);
  }

  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^##\s+/u.test(line));
  const actualSections = headings.map(({ line }) => line.replace(/^##\s+/u, "").trim());
  if (actualSections.length !== CONTINUITY_SECTIONS.length || actualSections.some((section, index) => section !== CONTINUITY_SECTIONS[index])) {
    throw new Error(`连续性状态必须依次且仅包含：${CONTINUITY_SECTIONS.join("、")}`);
  }

  const analysis = analyzeContinuityState(content);
  if (analysis.sectionItemCounts["下一章交接"] > 6) throw new Error("连续性状态的下一章交接不得超过6条");
  return analysis;
}

export function continuityStateWarning(analysis: ContinuityStateAnalysis) {
  return analysis.warnings.length ? analysis.warnings.join("；") : null;
}

export function buildContinuityStateInstructions(chapterNumber: number) {
  return `连续性标记后输出重新整理过的最新状态快照，而不是在旧快照末尾追加内容。第一行必须是“# 正文连续性状态”，第二行必须是精确标记“<!-- DROPMIND_STATE_THROUGH: ${chapterNumber} -->”，随后明确写出“截至第${chapterNumber}章”。

快照必须依次且仅包含以下五个二级标题：

- “当前时空”：最多6条，只记当前时间、主场景和仍在进行的动作；已经离开的上一场景不保留。
- “活跃人物状态与知情差”：只保留本章出现或预计未来3章内会行动的人物；每人只记变化中的伤势、持有物、目标、关系和关键知情差。年龄、职业、完整背景、稳定性格等应留在核心设定，不得重复。
- “未解决线索”：所有仍未解决的线索保留稳定编号，不得无故删除或改号；每条压缩为一行“当前结论；仍未知；下一触发点”，并标记P0当前、P1本剧情单元或P2长期。本章明确解决的线索从快照移除，只留在本章连续性事件中。
- “硬事实”：只保留一旦写错会造成后续正文矛盾、且未在其他栏目记录的事实；已结束且近期不会再次影响剧情的事件不保留。
- “下一章交接”：最多6条，只记下一章开场必须直接承接的时间、位置、动作、知情差和悬念。

同一事实只能有一个主要存放位置；除“下一章交接”可以简短引用外，不得跨栏目重复复述。目标控制在${CONTINUITY_TARGET_CHARS}字符以内，超过${CONTINUITY_WARNING_CHARS}字符视为偏长，绝对不得超过${CONTINUITY_MAX_CHARS}字符。不得把未来大纲写成已经发生的事实。`;
}
