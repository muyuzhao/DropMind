# Local Novel Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only six-step novel workbench that fills prompt templates, saves pasted Gemini results, manages the first 60 chapters, and supports backup and export.

**Architecture:** Add an isolated `novels` module to the existing Next.js App Router project. The module uses its own SQLite database through Drizzle so the existing PostgreSQL inbox module remains untouched; server actions expose repository operations to focused client components, while pure prompt and export functions remain independently testable.

**Tech Stack:** Next.js, React, TypeScript, Drizzle ORM, better-sqlite3, Zod, Vitest, plain CSS.

---

## File map

- `src/lib/novel-db/schema.ts`: SQLite tables and inferred types.
- `src/lib/novel-db/index.ts`: local database connection and one-time schema initialization.
- `src/modules/novels/templates.ts`: six default Chinese prompt templates.
- `src/modules/novels/prompts.ts`: named placeholder rendering and dependency validation.
- `src/modules/novels/ranges.ts`: 5-chapter range helpers.
- `src/modules/novels/repository.ts`: all novel persistence operations.
- `src/modules/novels/backup.ts`: JSON backup validation and TXT export.
- `src/app/novels/actions.ts`: validated server actions.
- `src/app/novels/page.tsx`: project dashboard.
- `src/app/novels/new/page.tsx`: create form.
- `src/app/novels/[id]/page.tsx`: six-step workspace shell.
- `src/components/novels/novel-dashboard.tsx`: project cards and import UI.
- `src/components/novels/novel-workspace.tsx`: step navigation and selection state.
- `src/components/novels/step-editor.tsx`: prompt/result editor and clipboard behavior.
- `src/components/novels/chapter-selector.tsx`: range/chapter navigation.
- `src/modules/novels/*.test.ts`: domain and repository tests.
- `src/app/globals.css`: novel-workbench styles.
- `README.md`: local startup and backup instructions.

### Task 1: Add the isolated SQLite database

**Files:**
- Modify: `package.json`
- Create: `src/lib/novel-db/schema.ts`
- Create: `src/lib/novel-db/index.ts`
- Test: `src/lib/novel-db/schema.test.ts`

- [ ] **Step 1: Add the database dependencies**

Run:

```powershell
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Expected: `package.json` lists both packages and installation exits with code 0.

- [ ] **Step 2: Write the failing schema test**

```ts
import { describe, expect, it } from "vitest";
import { chapterStatusValues, stepKeyValues } from "./schema";

describe("novel database enums", () => {
  it("keeps the six workflow keys in order", () => {
    expect(stepKeyValues).toEqual(["topics", "volumes", "settings", "units", "outlines", "drafts"]);
  });

  it("supports the three chapter states", () => {
    expect(chapterStatusValues).toEqual(["not_started", "saved", "published"]);
  });
});
```

- [ ] **Step 3: Verify the test fails**

Run: `npm test -- src/lib/novel-db/schema.test.ts`

Expected: FAIL because `./schema` does not exist.

- [ ] **Step 4: Define the SQLite schema**

Create tables `novels`, `prompt_templates`, `novel_steps`, `story_units`, `chapter_outlines`, `chapters`, and `content_versions` with text UUID primary keys, integer timestamps, unique `(novelId, key)`, `(novelId, startChapter)`, and `(novelId, chapterNumber)` constraints. Export these constants exactly:

```ts
export const stepKeyValues = ["topics", "volumes", "settings", "units", "outlines", "drafts"] as const;
export const chapterStatusValues = ["not_started", "saved", "published"] as const;
```

Use `sqliteTable`, `text`, `integer`, `uniqueIndex`, and `index` from `drizzle-orm/sqlite-core`. Include `referenceTitle`, `referenceSummary`, `selectedTopic`, `firstVolumeOutline`, `currentStep`, `createdAt`, and `updatedAt` on `novels`.

- [ ] **Step 5: Add the local connection and initializer**

`src/lib/novel-db/index.ts` must open `data/novels.db`, create `data` when absent, enable foreign keys, and execute idempotent `CREATE TABLE IF NOT EXISTS` statements before exporting `novelDb`.

```ts
const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const sqlite = new Database(path.join(dataDir, "novels.db"));
sqlite.pragma("foreign_keys = ON");
export const novelDb = drizzle(sqlite, { schema });
```

- [ ] **Step 6: Run focused verification and commit**

Run: `npm test -- src/lib/novel-db/schema.test.ts`

Expected: PASS.

Commit:

```powershell
git add package.json package-lock.json src/lib/novel-db
git commit -m "feat: add local novel database"
```

### Task 2: Implement prompt templates and deterministic rendering

**Files:**
- Create: `src/modules/novels/templates.ts`
- Create: `src/modules/novels/prompts.ts`
- Create: `src/modules/novels/ranges.ts`
- Test: `src/modules/novels/prompts.test.ts`
- Test: `src/modules/novels/ranges.test.ts`

- [ ] **Step 1: Write failing prompt tests**

```ts
import { describe, expect, it } from "vitest";
import { renderPrompt } from "./prompts";

describe("renderPrompt", () => {
  it("replaces repeated named fields", () => {
    expect(renderPrompt("《{{title}}》：{{title}}", { title: "测试书" })).toBe("《测试书》：测试书");
  });

  it("reports every missing field", () => {
    expect(() => renderPrompt("{{title}}/{{summary}}", { title: "测试书" })).toThrow("summary");
  });
});
```

- [ ] **Step 2: Write failing range tests**

```ts
import { describe, expect, it } from "vitest";
import { FIVE_CHAPTER_RANGES, rangeForChapter } from "./ranges";

describe("chapter ranges", () => {
  it("creates twelve ranges", () => expect(FIVE_CHAPTER_RANGES).toHaveLength(12));
  it("maps chapter 60 to 56-60", () => expect(rangeForChapter(60)).toEqual({ start: 56, end: 60 }));
});
```

- [ ] **Step 3: Verify both tests fail**

Run: `npm test -- src/modules/novels/prompts.test.ts src/modules/novels/ranges.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement pure rendering and ranges**

`renderPrompt(template, values)` must find `/\{\{([a-zA-Z0-9_]+)\}\}/g`, collect missing or blank values, throw one Chinese error listing all missing keys, then replace every occurrence. `FIVE_CHAPTER_RANGES` must contain `{ start, end }` values from 1-5 through 56-60, and `rangeForChapter` must reject numbers outside 1-60.

- [ ] **Step 5: Store the six exact user templates**

Create `DEFAULT_PROMPT_TEMPLATES`, keyed by the six step keys. Preserve the user's wording and Canvas requests. Replace ambiguous brackets with named placeholders including `{{reference_title}}`, `{{reference_summary}}`, `{{selected_topic}}`, `{{volume_outline}}`, `{{core_settings}}`, `{{range_start}}`, `{{range_end}}`, `{{story_unit}}`, `{{chapter_outline}}`, `{{previous_chapter}}`, and `{{chapter_number}}`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/modules/novels/prompts.test.ts src/modules/novels/ranges.test.ts`

Expected: PASS.

Commit:

```powershell
git add src/modules/novels
git commit -m "feat: add novel prompt workflow"
```

### Task 3: Build repository, versions, backup, and export

**Files:**
- Create: `src/modules/novels/repository.ts`
- Create: `src/modules/novels/backup.ts`
- Test: `src/modules/novels/repository.test.ts`
- Test: `src/modules/novels/backup.test.ts`

- [ ] **Step 1: Write failing repository tests using a temporary database**

Test these concrete behaviors: creating a novel seeds six templates, saving chapter 2 preserves chapter 1, formally saving content appends a version, and deleting a novel cascades its children. Expose `createNovelRepository(sqlite: Database.Database)` so tests can use `new Database(":memory:")`.

```ts
const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
expect(repo.listNovels()[0].name).toBe("测试小说");
expect(repo.getTemplates(novel.id)).toHaveLength(6);
```

- [ ] **Step 2: Verify repository tests fail**

Run: `npm test -- src/modules/novels/repository.test.ts`

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement focused repository methods**

Implement and export:

```ts
createNovel(input)
listNovels()
getNovelWorkspace(id)
updateNovel(id, patch)
saveStep(novelId, key, content, draft)
saveStoryUnit(novelId, startChapter, content, draft)
saveChapterOutline(novelId, chapterNumber, content, draft)
saveChapter(novelId, chapterNumber, content, status, draft)
getTemplates(novelId)
updateTemplate(novelId, key, template)
deleteNovel(id)
```

Every non-draft save must write the previous content to `content_versions` in the same transaction. Creation must seed template snapshots from `DEFAULT_PROMPT_TEMPLATES`.

- [ ] **Step 4: Write backup/export tests**

Test that backup round-trips all records into a new project ID, malformed input throws without adding rows, and TXT export sorts chapter 2 before chapter 10 while excluding unsaved chapters.

- [ ] **Step 5: Implement backup and TXT export**

Define a versioned Zod schema with `format: "dropmind-novel"` and `version: 1`. `importNovelBackup` must validate before opening a transaction and append `（导入）` to the project name. `exportVolumeText` must emit `第N章\n\n正文` blocks joined by two blank lines.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/modules/novels/repository.test.ts src/modules/novels/backup.test.ts`

Expected: PASS.

Commit:

```powershell
git add src/modules/novels src/lib/novel-db
git commit -m "feat: persist and export novel projects"
```

### Task 4: Add validated server actions

**Files:**
- Create: `src/app/novels/actions.ts`
- Create: `src/modules/novels/schemas.ts`
- Test: `src/modules/novels/schemas.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
expect(createNovelSchema.parse({ name: "  新书  ", referenceTitle: "参考", referenceSummary: "简介" }).name).toBe("新书");
expect(() => saveChapterSchema.parse({ novelId: "x", chapterNumber: 61, content: "正文" })).toThrow();
```

- [ ] **Step 2: Verify failure, then implement schemas**

Run: `npm test -- src/modules/novels/schemas.test.ts`

Expected before implementation: FAIL. Define schemas for create, update, save step, save unit, save outline, save chapter, template update, import, and delete confirmation; chapter numbers must be integers from 1 through 60 and content may be empty only for draft saves.

- [ ] **Step 3: Implement server actions**

Each action must parse input, call one repository method, invoke `revalidatePath`, and return `{ ok: true }` or `{ ok: false, error }`. `deleteNovelAction` must compare the submitted confirmation name to the stored project name. Export/import actions must return serializable strings rather than Response objects.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/modules/novels/schemas.test.ts && npm run typecheck`

Expected: PASS and no TypeScript errors.

Commit:

```powershell
git add src/app/novels/actions.ts src/modules/novels/schemas*
git commit -m "feat: add novel workspace actions"
```

### Task 5: Build the project dashboard

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/novels/page.tsx`
- Create: `src/app/novels/new/page.tsx`
- Create: `src/components/novels/novel-dashboard.tsx`
- Create: `src/components/novels/new-novel-form.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Redirect the root to the novel dashboard**

Change `redirect("/inbox")` to `redirect("/novels")`.

- [ ] **Step 2: Build the server-rendered dashboard**

Load `listNovels()` in `src/app/novels/page.tsx`. Render an empty state or project cards showing name, reference title, current step, completed/published counts, updated time, and a `/novels/[id]` continuation link.

- [ ] **Step 3: Build the create form**

The form must contain required name, reference title, and reference summary fields; submit through `createNovelAction`; display inline errors; and redirect to the new workspace after success.

- [ ] **Step 4: Style and verify**

Add `.novel-*` classes using the existing paper/card color variables, with a responsive one-column layout below 760px.

Run: `npm run lint && npm run typecheck`

Expected: both pass.

- [ ] **Step 5: Commit**

```powershell
git add src/app/page.tsx src/app/novels src/components/novels src/app/globals.css
git commit -m "feat: add novel project dashboard"
```

### Task 6: Build the six-step workspace

**Files:**
- Create: `src/app/novels/[id]/page.tsx`
- Create: `src/components/novels/novel-workspace.tsx`
- Create: `src/components/novels/step-editor.tsx`
- Create: `src/components/novels/chapter-selector.tsx`
- Test: `src/modules/novels/workflow.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Test `buildPromptContext(workspace, selection)` for these cases: topics uses reference fields; volumes refuses blank selected topic; chapter 1 omits previous content; chapter 2 includes chapter 1; chapter 60 uses the 56-60 unit.

- [ ] **Step 2: Implement prompt-context construction**

Add `buildPromptContext` to `prompts.ts`. It must return `{ prompt, missing }`, never silently insert `undefined`, and only call `renderPrompt` when `missing` is empty.

- [ ] **Step 3: Build the workspace server page**

Load one full workspace by ID and call `notFound()` when absent. Pass serializable data to `NovelWorkspace`.

- [ ] **Step 4: Build client interaction**

`NovelWorkspace` owns selected step, range, and chapter. `StepEditor` shows dependencies, generated prompt, copy button, result textarea, character count, save, and save-next. Use a 700ms debounce for draft saves and cancel stale timers when selection changes.

Clipboard behavior:

```ts
try {
  await navigator.clipboard.writeText(prompt);
  setCopyState("copied");
} catch {
  promptRef.current?.select();
  setCopyState("manual");
}
```

- [ ] **Step 5: Add range and chapter navigation**

Render 12 range buttons for steps 4 and 5, and 60 chapter buttons for step 6. Show saved/published state through color and text, not color alone. Save-next advances at most to chapter 60.

- [ ] **Step 6: Run verification and commit**

Run: `npm test -- src/modules/novels/workflow.test.ts && npm run lint && npm run typecheck`

Expected: all pass.

Commit:

```powershell
git add src/app/novels/[id] src/components/novels src/modules/novels
git commit -m "feat: add six-step novel workspace"
```

### Task 7: Add templates, backup, restore, delete, and TXT export UI

**Files:**
- Create: `src/components/novels/template-settings.tsx`
- Create: `src/components/novels/project-tools.tsx`
- Modify: `src/components/novels/novel-workspace.tsx`
- Modify: `src/components/novels/novel-dashboard.tsx`

- [ ] **Step 1: Add template settings**

Render six editable template textareas with reset-to-default and save controls. Before saving, show the named placeholders detected in each template so accidental removal is visible.

- [ ] **Step 2: Add browser downloads**

Create downloads without a server file write:

```ts
const url = URL.createObjectURL(new Blob([content], { type: mime }));
const anchor = document.createElement("a");
anchor.href = url;
anchor.download = filename;
anchor.click();
URL.revokeObjectURL(url);
```

Provide JSON backup and UTF-8 TXT export buttons.

- [ ] **Step 3: Add import and destructive confirmation**

Read a selected JSON file with `file.text()`, pass it to `importNovelAction`, and show validation errors. Deletion requires typing the exact novel name and then redirects to `/novels`.

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

Expected: all checks pass.

Commit:

```powershell
git add src/components/novels src/app/novels
git commit -m "feat: add novel project tools"
```

### Task 8: End-to-end verification and local-use documentation

**Files:**
- Modify: `README.md`
- Create: `start-novel-workbench.cmd`
- Modify: `.gitignore`

- [ ] **Step 1: Document local use**

Add exact instructions: run `npm install` once, double-click `start-novel-workbench.cmd`, open `http://localhost:3000`, use JSON backup regularly, and stop with `Ctrl+C` in the command window.

- [ ] **Step 2: Add the launcher and ignore local content**

`start-novel-workbench.cmd`:

```bat
@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run dev
```

Add `/data/` to `.gitignore` so novel content never enters Git.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform the manual acceptance flow**

Create a test novel, save a selected topic, five-volume outline, first-volume outline, settings, the 1-5 unit, chapter 1 and 2 outlines, and chapter 1 and 2 bodies. Refresh after each step; verify chapter 2 prompt contains chapter 1. Export TXT and confirm ordering. Export JSON, import it, and confirm the copied project matches. Delete both test projects.

- [ ] **Step 5: Final commit**

```powershell
git add README.md start-novel-workbench.cmd .gitignore
git commit -m "docs: add local novel workbench startup"
```

