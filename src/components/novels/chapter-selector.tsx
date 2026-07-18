import { TEN_CHAPTER_RANGES } from "@/modules/novels/ranges";

export type SelectorItemState = "blocked" | "ready" | "saved" | "published";

const STATE_LABELS: Record<SelectorItemState, string> = {
  blocked: "缺少前置内容",
  ready: "可以开始",
  saved: "已保存",
  published: "已发布",
};

function ItemButton({ itemValue, label, value, state, onChange }: { itemValue: number; label: string; value: number; state: SelectorItemState; onChange: (value: number) => void }) {
  return <button type="button" className={`${itemValue === value ? "active" : ""} state-${state}`} title={STATE_LABELS[state]} onClick={() => onChange(itemValue)}>
    <span className="selector-state-dot" aria-hidden="true" />{label}
  </button>;
}

export function ChapterSelector({ mode, value, onChange, states }: { mode: "range" | "chapter"; value: number; onChange: (value: number) => void; states: Map<number, SelectorItemState> }) {
  if (mode === "range") return <div className="novel-selector range">
    {TEN_CHAPTER_RANGES.map((range) => <ItemButton key={range.start} itemValue={range.start} label={`${range.start}-${range.end}章`} value={value} state={states.get(range.start) ?? "blocked"} onChange={onChange} />)}
    <div className="selector-legend"><span className="state-ready">可开始</span><span className="state-saved">已保存</span><span className="state-blocked">缺前置</span></div>
  </div>;

  return <div className="chapter-groups">
    {TEN_CHAPTER_RANGES.map((range) => {
      const chapters = Array.from({ length: 10 }, (_, index) => range.start + index);
      const completed = chapters.filter((chapter) => ["saved", "published"].includes(states.get(chapter) ?? "")).length;
      return <section className="chapter-group" key={range.start}>
        <header><strong>{range.start}-{range.end}章</strong><span>{completed}/10</span></header>
        <div className="novel-selector chapter">{chapters.map((chapter) => <ItemButton key={chapter} itemValue={chapter} label={String(chapter)} value={value} state={states.get(chapter) ?? "blocked"} onChange={onChange} />)}</div>
      </section>;
    })}
    <div className="selector-legend"><span className="state-ready">可写</span><span className="state-saved">已保存</span><span className="state-published">已发布</span><span className="state-blocked">缺前置</span></div>
  </div>;
}
