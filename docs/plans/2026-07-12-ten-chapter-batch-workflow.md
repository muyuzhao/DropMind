# Ten Chapter Batch Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make steps 4 and 5 operate in six ten-chapter batches, with a reusable manually saved volume outline and placeholder-aware prompts.

**Architecture:** Replace the shared five-chapter range model with a ten-chapter batch model used by steps 4–6. Keep the existing novel outline field and content tables, add a one-time database migration marker for clearing incompatible results, and migrate only recognizable legacy prompt formats.

**Tech Stack:** TypeScript, React, Next.js, better-sqlite3, Vitest

---

### Task 1: Remove the superseded uncommitted implementation

**Files:**
- Restore: `src/lib/novel-db/index.ts`
- Restore: `src/lib/novel-db/index.test.ts`
- Restore: `src/modules/novels/templates.ts`
- Delete: `src/modules/novels/unit-template-migration.ts`
- Delete: `src/modules/novels/unit-template-migration.test.ts`

- [ ] Use `git diff` to isolate the uncommitted “remove repeated context” changes.
- [ ] Use `apply_patch` to restore only those hunks to `HEAD`; preserve all committed prompt-scheme work.
- [ ] Run the existing test suite and expect the original 25 tests to pass.

### Task 2: Introduce ten-chapter batch ranges with TDD

**Files:**
- Modify: `src/modules/novels/ranges.test.ts`
- Modify: `src/modules/novels/workflow.test.ts`
- Modify: `src/modules/novels/ranges.ts`
- Modify: `src/components/novels/chapter-selector.tsx`

- [ ] Replace the range tests with assertions that `TEN_CHAPTER_RANGES` contains six ranges and that chapters 1, 10, 11, 30, 51, and 60 map to the expected batch.
- [ ] Add workflow fixtures and assertions proving a `units` selection at 21 renders `本卷大纲/21-30`, a selection at 51 renders `51-60`, and step 5 reads the story unit stored at the current ten-chapter start.
- [ ] Run `vitest run src/modules/novels/ranges.test.ts src/modules/novels/workflow.test.ts`; expect failures because the ten-chapter export and mapping do not exist.
- [ ] Implement:

```ts
export const TEN_CHAPTER_RANGES = Array.from({ length: 6 }, (_, index) => ({
  start: index * 10 + 1,
  end: index * 10 + 10,
}));

export function rangeForChapter(chapter: number) {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 60) throw new Error("章节必须在1-60之间");
  return TEN_CHAPTER_RANGES[Math.floor((chapter - 1) / 10)];
}
```

- [ ] Update `ChapterSelector` to render `TEN_CHAPTER_RANGES` for range mode.
- [ ] Re-run the focused test; expect pass.

### Task 3: Correct the default step-4 and step-5 prompts

**Files:**
- Create: `src/modules/novels/templates.test.ts`
- Modify: `src/modules/novels/templates.ts`

- [ ] Write failing tests asserting `units` contains `{{first_volume_outline}}`, `{{range_start}}`, and `{{range_end}}`, and `outlines` contains `{{story_unit}}`, `{{range_start}}`, and `{{range_end}}`.
- [ ] Assert the unit prompt says each ten-chapter batch contains two approximately five-chapter units.
- [ ] Run the focused test and confirm failure against the old templates.
- [ ] Replace the default `units` template with the user-approved structure: saved volume outline first, current ten-chapter range, two five-chapter units, 起承转合 requirements, humor, female-audience payoff, logic, and Canvas output.
- [ ] Replace the default `outlines` template with the user-provided ten-chapter detailed-outline prompt, retaining all ten numbered writing requirements and the required `【本章核心】【场景】【剧情详解】结尾钩子` format.
- [ ] Re-run the focused tests; expect pass.

### Task 4: Save ten-chapter results and expose the volume-outline editor

**Files:**
- Modify: `src/modules/novels/repository.test.ts`
- Modify: `src/modules/novels/repository.ts`
- Modify: `src/components/novels/novel-workspace.tsx`

- [ ] Add a failing repository test proving `saveStoryUnit(novelId, 21, ...)` stores `endChapter: 30`.
- [ ] Change `saveStoryUnit` from `startChapter + 4` to `startChapter + 9` and verify the test passes.
- [ ] In step 4, render a “本卷大纲” textarea bound to `firstVolumeOutline`; save through the existing `updateNovelAction`.
- [ ] Show the same six ten-chapter selectors for steps 4 and 5.
- [ ] Change step-5 save behavior from five outline rows to ten rows for `rangeStart ... rangeStart + 9`.
- [ ] Keep step 6 chapter-by-chapter; its prompt lookup now resolves the chapter’s ten-chapter unit and outline through `rangeForChapter`.

### Task 5: Add recognizable prompt migration and one-time content reset

**Files:**
- Create: `src/modules/novels/batch-workflow-migration.ts`
- Create: `src/modules/novels/batch-workflow-migration.test.ts`
- Modify: `src/lib/novel-db/index.ts`
- Modify: `src/lib/novel-db/index.test.ts`

- [ ] Write pure-helper tests for recognized legacy step-4 and step-5 templates: empty leading `【】` becomes `【{{first_volume_outline}}】`, fixed `1-10` becomes `{{range_start}}-{{range_end}}`, and a highly custom unrelated template is unchanged.
- [ ] Implement narrow string/regular-expression replacements that only return a changed value when a known legacy signature is present.
- [ ] Add `app_migrations (key TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)` to schema initialization.
- [ ] Write a failing database test that inserts old story units and chapter outlines, initializes again, and expects both tables cleared plus migration marker `ten-chapter-batches-v1`.
- [ ] In one transaction, when the marker is absent: migrate recognizable `units` and `outlines` rows in `prompt_scheme_templates` and `prompt_templates`, delete `story_units` and `chapter_outlines`, then insert the marker.
- [ ] Initialize a third time after inserting new results and prove they remain, establishing idempotence.

### Task 6: Full verification and branch completion

**Files:**
- Modify only files already in scope if verification reveals a defect.

- [ ] Run the full Vitest suite and require zero failures.
- [ ] Run TypeScript with the bundled Node runtime and require exit code 0.
- [ ] Run ESLint and require exit code 0.
- [ ] Run the Next.js production build and require exit code 0.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Commit the implementation intentionally, then push `codex/novel-workbench` after successful verification.
