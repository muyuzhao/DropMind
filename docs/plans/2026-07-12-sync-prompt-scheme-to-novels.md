# Sync Prompt Scheme to Existing Novels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users overwrite all six prompt snapshots of selected existing novels from a chosen prompt scheme.

**Architecture:** Add one transactional repository method, expose it through a validated server action, and extend the existing prompt manager with a multi-select synchronization panel. The operation changes only `prompt_templates` rows.

**Tech Stack:** TypeScript, React, Next.js server actions, better-sqlite3, Vitest

---

### Task 1: Implement transactional repository synchronization with TDD

**Files:**
- Modify: `src/modules/novels/repository.test.ts`
- Modify: `src/modules/novels/repository.ts`

- [ ] Add a failing test that creates a custom scheme and two novels, changes all six scheme templates to identifiable values, saves creative content to one novel, and calls the wished-for API:

```ts
expect(repo.syncPromptSchemeToNovels(scheme.id, [novelA.id, novelB.id, novelA.id])).toBe(2);
```

- [ ] Assert both novels now contain all six scheme template values and the saved novel step/chapter content is unchanged.
- [ ] Add failure tests for a missing scheme, an incomplete six-template scheme, an empty novel list, and a missing novel ID; assert no target snapshot changes after each failure.
- [ ] Run `vitest run src/modules/novels/repository.test.ts` and confirm failure because the method does not exist.
- [ ] Implement `syncPromptSchemeToNovels(schemeId: string, novelIds: string[])` inside `createNovelRepository`:
  - trim/deduplicate IDs;
  - require at least one target;
  - load and validate exactly six scheme templates covering all `stepKeys`;
  - validate every target novel before updating;
  - run all updates in one SQLite transaction;
  - update `prompt_templates.template`, template timestamps, and novel timestamps;
  - return the unique target count.
- [ ] Re-run the focused test and require all repository tests to pass.

### Task 2: Add the server action

**Files:**
- Modify: `src/app/novels/actions.ts`
- Modify: `src/modules/novels/schemas.ts`

- [ ] Add a Zod schema requiring a non-empty `schemeId` and an array containing at least one non-empty `novelId`.
- [ ] Add `syncSchemeToNovelsAction(input)` that parses input, calls the repository method, revalidates `/novels/prompts` and each selected `/novels/[id]` path, and returns `{ ok: true, count }`.
- [ ] Preserve the existing common error return shape so repository errors display in the UI.
- [ ] Run TypeScript and confirm the new action compiles before wiring the component.

### Task 3: Add the multi-select synchronization UI

**Files:**
- Modify: `src/app/novels/prompts/page.tsx`
- Modify: `src/components/novels/prompt-scheme-manager.tsx`
- Modify: `src/app/globals.css`

- [ ] Load `novelRepository.listNovels()` in the page and pass `{ id, name }` records to `PromptSchemeManager`.
- [ ] Refactor the compressed manager component only enough to keep synchronization state readable; preserve all current create/edit/default/delete behavior.
- [ ] Add a “同步到已有小说” button for the selected scheme.
- [ ] On expansion, show checkboxes for every novel, the overwrite warning naming the selected scheme, a cancel button, and a confirm button disabled until at least one novel is selected.
- [ ] Before the server call, use `window.confirm` with the scheme name and selected count.
- [ ] Call `syncSchemeToNovelsAction`, display errors inline, or display “已同步 N 本小说” and clear the selection on success.
- [ ] Ensure changing the active scheme closes the panel and clears selected novel IDs.

### Task 4: Verify and publish

**Files:**
- Modify only files already in scope if verification reveals a defect.

- [ ] Run the full Vitest suite and require zero failures.
- [ ] Run TypeScript and ESLint with the bundled Node runtime and require exit code 0.
- [ ] Run the Next.js production build and require exit code 0.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Commit the feature and push `codex/novel-workbench`.
- [ ] After the UI is available, synchronize “新方案 2” to “古言1” through the new button; do not perform a hidden database edit.
