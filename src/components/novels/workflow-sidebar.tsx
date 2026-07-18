"use client";

import Link from "next/link";
import type { StepKey } from "@/lib/novel-db/schema";
import { STEP_LABELS } from "@/modules/novels/templates";
import type { WorkflowStepOverview, WorkPosition } from "@/modules/novels/work-state";

const STEPS = Object.keys(STEP_LABELS) as StepKey[];

export function WorkflowSidebar({ open, novelName, activeStep, position, overview, onToggle, onOpen, onLeave, onBackup, onExportText }: {
  open: boolean; novelName: string; activeStep: StepKey; position: WorkPosition;
  overview: Record<StepKey, WorkflowStepOverview>;
  onToggle: () => void; onOpen: (position: WorkPosition) => void; onLeave: () => boolean;
  onBackup: () => void; onExportText: () => void;
}) {
  return <aside className="workspace-sidebar">
    <div className="workspace-sidebar-top">
      {open && <Link className="workspace-brand" href="/" aria-label="DropMind 首页" onClick={(event) => { if (!onLeave()) event.preventDefault(); }}><span className="brand-mark">D</span><span>DropMind</span></Link>}
      <button className="workspace-sidebar-toggle" type="button" aria-expanded={open} title={open ? "收起侧栏" : "展开侧栏"} onClick={onToggle}>{open ? "‹" : "☰"}</button>
    </div>
    <div className="workspace-sidebar-content">
      <Link className="workspace-back-link" href="/novels" onClick={(event) => { if (!onLeave()) event.preventDefault(); }}>← 小说列表</Link>
      <h2>{novelName}</h2>
      <nav>{STEPS.map((key) => { const item = overview[key]; return <button type="button" className={`${activeStep === key ? "active" : ""} step-${item.state}`} title={item.reason} key={key} onClick={() => onOpen({ ...position, step: key })}><span className="workspace-step-name"><i aria-hidden="true" />{STEP_LABELS[key]}</span><span className="workspace-step-progress">{item.state === "complete" ? "✓" : `${item.completed}/${item.total}`}</span></button>; })}</nav>
      <div className="workspace-tools"><button type="button" onClick={onBackup}>备份 JSON</button><button type="button" onClick={onExportText}>导出正文 TXT</button></div>
    </div>
  </aside>;
}
