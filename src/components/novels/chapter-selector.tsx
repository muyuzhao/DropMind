import { TEN_CHAPTER_RANGES } from "@/modules/novels/ranges";

export function ChapterSelector({ mode, value, onChange, saved }: { mode: "range" | "chapter"; value: number; onChange: (value: number) => void; saved: Set<number> }) {
  const items = mode === "range" ? TEN_CHAPTER_RANGES.map((range) => ({ value: range.start, label: `${range.start}-${range.end}章` })) : Array.from({ length: 60 }, (_, index) => ({ value: index + 1, label: `${index + 1}` }));
  return <div className={`novel-selector ${mode}`}>{items.map((item) => <button type="button" className={item.value === value ? "active" : ""} key={item.value} onClick={() => onChange(item.value)}>{saved.has(item.value) ? "● " : ""}{item.label}</button>)}</div>;
}
