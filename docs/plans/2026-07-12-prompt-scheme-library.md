# Prompt Scheme Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable six-template prompt schemes that users select when creating a novel, while keeping every existing novel's prompt snapshot unchanged.

**Architecture:** Extend the isolated novel SQLite database with scheme and scheme-template tables, then add repository methods that enforce default and deletion rules in transactions. Keep novel templates as snapshots; the creation action reads one complete scheme and copies it into the novel. A dedicated management page edits schemes, while the existing new-novel form only selects one.

**Tech Stack:** Next.js, React, TypeScript, SQLite, better-sqlite3, Zod, Vitest, plain CSS.

---

### Task 1: Add scheme tables and idempotent default seeding

**Files:**
- Modify: `src/lib/novel-db/schema.ts`
- Modify: `src/lib/novel-db/index.ts`
- Modify: `src/lib/novel-db/index.test.ts`

- [ ] **Step 1: Extend the failing database test**

Add assertions that `initializeNovelDatabase(sqlite)` creates `prompt_schemes` and `prompt_scheme_templates`, and that `seedDefaultPromptScheme(sqlite)` produces exactly one system/default scheme with six templates even when called twice.

```ts
seedDefaultPromptScheme(sqlite);
seedDefaultPromptScheme(sqlite);
expect(sqlite.prepare("select count(*) count from prompt_schemes").get()).toMatchObject({ count: 1 });
expect(sqlite.prepare("select count(*) count from prompt_scheme_templates").get()).toMatchObject({ count: 6 });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/novel-db/index.test.ts`

Expected: FAIL because the new tables and `seedDefaultPromptScheme` do not exist.

- [ ] **Step 3: Define Drizzle tables and SQL initialization**

Add `promptSchemes` with unique `name`, boolean `isSystem`/`isDefault`, description and timestamps. Add `promptSchemeTemplates` with a cascading scheme reference and unique `(schemeId, key)`. Extend `CREATE_SCHEMA` with matching SQL.

- [ ] **Step 4: Implement deterministic default seeding**

Export `SYSTEM_SCHEME_ID = "system-default"` and `seedDefaultPromptScheme(sqlite)`. Insert the scheme with `INSERT OR IGNORE`, then insert/update the six missing templates from `DEFAULT_PROMPT_TEMPLATES` without overwriting user edits that already exist. Call seeding after schema initialization.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/lib/novel-db/index.test.ts src/lib/novel-db/schema.test.ts`

Expected: PASS.

```powershell
git add src/lib/novel-db
git commit -m "feat: add prompt scheme storage"
```

### Task 2: Implement scheme rules and novel snapshot isolation

**Files:**
- Modify: `src/modules/novels/repository.ts`
- Modify: `src/modules/novels/repository.test.ts`
- Create: `src/modules/novels/scheme-placeholders.ts`
- Create: `src/modules/novels/scheme-placeholders.test.ts`

- [ ] **Step 1: Write failing repository behavior tests**

Cover these exact cases:

```ts
const copy = repo.createPromptScheme({ name: "古言版", description: "古言测试" });
expect(repo.getPromptScheme(copy.id)!.templates).toHaveLength(6);
repo.setDefaultPromptScheme(copy.id);
expect(repo.listPromptSchemes().filter((item) => item.isDefault)).toHaveLength(1);
expect(() => repo.deletePromptScheme(copy.id)).toThrow("默认方案");
```

Create a novel with the copied scheme, update that scheme's `topics` template, and assert the novel's stored `topics` template remains the pre-edit value.

- [ ] **Step 2: Verify repository tests fail**

Run: `npm test -- src/modules/novels/repository.test.ts`

Expected: FAIL because scheme repository methods do not exist.

- [ ] **Step 3: Implement repository methods**

Add:

```ts
listPromptSchemes()
getPromptScheme(id)
createPromptScheme({ name, description, sourceSchemeId? })
updatePromptScheme(id, { name, description })
updatePromptSchemeTemplate(id, key, template)
setDefaultPromptScheme(id)
deletePromptScheme(id)
```

`setDefaultPromptScheme` must clear the old default and set the new one in one transaction. `deletePromptScheme` must reject system/default rows. Scheme creation must copy all six templates from the source or system scheme.

Change `createNovel(input, schemeId?)` to read the requested or default scheme, verify six distinct step keys, and insert those values into `prompt_templates` inside the same transaction as the novel.

- [ ] **Step 4: Write placeholder validation tests**

Define required placeholders per step and test that a valid default template yields no missing fields while removing `{{chapter_outline}}` from `drafts` reports `chapter_outline`.

- [ ] **Step 5: Implement placeholder validation**

Export `requiredFieldsForStep(key)` and `missingRequiredFields(key, template)` using the existing `templateFields` helper. Requirements must match fields used by `buildPromptContext` for each of the six steps.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/modules/novels/repository.test.ts src/modules/novels/scheme-placeholders.test.ts`

Expected: PASS.

```powershell
git add src/modules/novels
git commit -m "feat: add prompt scheme rules"
```

### Task 3: Add validated actions and scheme selection during creation

**Files:**
- Modify: `src/modules/novels/schemas.ts`
- Modify: `src/modules/novels/schemas.test.ts`
- Modify: `src/app/novels/actions.ts`
- Modify: `src/app/novels/new/page.tsx`
- Modify: `src/components/novels/new-novel-form.tsx`

- [ ] **Step 1: Add failing validation tests**

Test trimmed scheme names, optional descriptions, required scheme IDs for scheme mutations, and optional `schemeId` on `createNovelSchema` for backward compatibility.

```ts
expect(createNovelSchema.parse({ name: "新书", referenceTitle: "参考", referenceSummary: "简介", schemeId: "scheme-1" }).schemeId).toBe("scheme-1");
expect(promptSchemeSchema.parse({ name: "  古言版  ", description: "说明" }).name).toBe("古言版");
```

- [ ] **Step 2: Verify RED, then implement Zod schemas**

Run: `npm test -- src/modules/novels/schemas.test.ts`

Expected before implementation: FAIL; after adding schemas: PASS.

- [ ] **Step 3: Add scheme server actions**

Add actions for create/copy, metadata update, template update, set default and delete. Template update must call `missingRequiredFields`; return a Chinese error listing missing placeholders rather than saving invalid content.

Update `createNovelAction` to pass `schemeId` to the repository.

- [ ] **Step 4: Add scheme selection to new novel page**

Load `listPromptSchemes()` on the server page and pass `{ id, name, isDefault }` records to `NewNovelForm`. Render a required `<select name="schemeId">`, defaulting to the default scheme. Preserve existing name, reference title and summary behavior.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/modules/novels/schemas.test.ts && npm run typecheck`

Expected: PASS.

```powershell
git add src/modules/novels/schemas* src/app/novels/actions.ts src/app/novels/new src/components/novels/new-novel-form.tsx
git commit -m "feat: select prompt schemes for new novels"
```

### Task 4: Build the prompt scheme management page

**Files:**
- Create: `src/app/novels/prompts/page.tsx`
- Create: `src/components/novels/prompt-scheme-manager.tsx`
- Modify: `src/app/novels/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Build the server page**

Load all schemes with templates and pass serializable records to `PromptSchemeManager`. Add a back link to `/novels`.

- [ ] **Step 2: Build the management client**

Render a scheme list, name/description editor, six step tabs and one template textarea. Show detected placeholders and missing required placeholders. Disable save when required placeholders are missing.

Provide buttons for new, copy, set default, restore current template to `DEFAULT_PROMPT_TEMPLATES[key]`, and delete. Hide or disable delete with explanatory text for system/default schemes. Use `window.confirm` before discarding dirty edits or deleting.

- [ ] **Step 3: Link from the dashboard and style responsively**

Add a “提示词管理” link beside “新建小说”. Add `.scheme-*` styles with a two-column desktop layout and single-column layout below 760px. Reuse existing paper, card, line and green variables.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Manual acceptance**

Create a custom scheme, edit its topic template, set it default, create one novel, modify the scheme again, and verify the novel still contains the original snapshot. Verify system/default delete controls are blocked.

- [ ] **Step 6: Commit**

```powershell
git add src/app/novels src/components/novels src/app/globals.css
git commit -m "feat: add prompt scheme manager"
```
