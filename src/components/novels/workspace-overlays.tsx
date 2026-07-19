"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type ArtifactPreview = {
  nodeId: string;
  title: string;
  path: string;
  content: string;
};

function useOverlayFocus(open: boolean, onClose: () => void) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timeout = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest<HTMLElement>("[role='dialog']");
      const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")] : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  return closeButtonRef;
}

export function WorkspaceConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  danger = false,
  busy = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const closeButtonRef = useOverlayFocus(open, onClose);
  if (!open) return null;

  return <div className="workspace-overlay-layer">
    <button type="button" className="workspace-overlay-scrim" aria-label="关闭确认对话框" onClick={onClose} />
    <section className="workspace-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-confirm-title" aria-describedby="workspace-confirm-description">
      <div>
        <p className="novel-kicker">需要确认</p>
        <h2 id="workspace-confirm-title">{title}</h2>
        <p id="workspace-confirm-description">{description}</p>
        {children}
      </div>
      <div className="workspace-dialog-actions">
        <button ref={closeButtonRef} type="button" className="button-quiet" data-overlay-initial-focus disabled={busy} onClick={onClose}>{cancelLabel}</button>
        <button type="button" className={danger ? "danger-button" : undefined} disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</button>
      </div>
    </section>
  </div>;
}

export function AutomationArtifactDrawer({ preview, onClose }: { preview: ArtifactPreview | null; onClose: () => void }) {
  const closeButtonRef = useOverlayFocus(Boolean(preview), onClose);
  if (!preview) return null;

  return <div className="workspace-overlay-layer automation-drawer-layer">
    <button type="button" className="workspace-overlay-scrim" aria-label="关闭输出预览" onClick={onClose} />
    <aside className="automation-artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="automation-artifact-title">
      <header>
        <div>
          <p className="novel-kicker">任务产物</p>
          <h2 id="automation-artifact-title">{preview.title}</h2>
          <small>{preview.path}</small>
        </div>
        <button ref={closeButtonRef} type="button" className="button-quiet" data-overlay-initial-focus onClick={onClose}>关闭</button>
      </header>
      <pre tabIndex={0}>{preview.content}</pre>
    </aside>
  </div>;
}
