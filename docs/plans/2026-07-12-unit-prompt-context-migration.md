# Unit Prompt Context Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the core-settings and first-volume-outline blocks from every step-4 prompt template while preserving the rest of each template.

**Architecture:** A focused pure helper will recognize and remove only the two leading context blocks from a `units` template. Database initialization will apply that helper idempotently to prompt-scheme templates and per-novel prompt snapshots, while the code default will already use the shortened form.

**Tech Stack:** TypeScript, Next.js, better-sqlite3, Vitest

---

### Task 1: Define and test the precise template transformation

**Files:**
- Create: `src/modules/novels/unit-template-migration.ts`
- Create: `src/modules/novels/unit-template-migration.test.ts`

- [ ] **Step 1: Write failing tests for precise and idempotent removal**

```ts
import { describe, expect, it } from "vitest";
import { removeUnitPromptBackground } from "./unit-template-migration";

describe("removeUnitPromptBackground", () => {
  const suffix = "现在基于第1卷的大纲，将第{{range_start}}-{{range_end}}章细分为剧情单元。";
  const legacy = `小说核心设定：\n【{{core_settings}}】\n第一卷大纲：\n【{{first_volume_outline}}】\n${suffix}`;

  it("removes only the two leading background blocks", () => {
    expect(removeUnitPromptBackground(legacy)).toBe(suffix);
  });

  it("leaves an already migrated or custom template unchanged", () => {
    expect(removeUnitPromptBackground(suffix)).toBe(suffix);
    expect(removeUnitPromptBackground(`自定义前言\n${legacy}`)).toBe(`自定义前言\n${legacy}`);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\vitest\vitest.mjs' run src/modules/novels/unit-template-migration.test.ts
```

Expected: FAIL because `unit-template-migration.ts` does not exist.

- [ ] **Step 3: Implement the narrow pure helper**

```ts
const LEADING_BACKGROUND = /^小说核心设定：\r?\n【\{\{core_settings\}\}】\r?\n第一卷大纲：\r?\n【\{\{first_volume_outline\}\}】\r?\n/;

export function removeUnitPromptBackground(template: string) {
  return template.replace(LEADING_BACKGROUND, "");
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run the command from Step 2.

Expected: 3 assertions pass.

- [ ] **Step 5: Commit the transformation helper**

```powershell
git add src/modules/novels/unit-template-migration.ts src/modules/novels/unit-template-migration.test.ts
git commit -m "test: define unit prompt background migration"
```

### Task 2: Shorten the built-in step-4 template

**Files:**
- Modify: `src/modules/novels/templates.ts`
- Modify: `src/modules/novels/unit-template-migration.test.ts`

- [ ] **Step 1: Add a failing assertion for the built-in template**

```ts
import { DEFAULT_PROMPT_TEMPLATES } from "./templates";

it("ships the unit template without repeated Gemini context", () => {
  expect(DEFAULT_PROMPT_TEMPLATES.units).not.toContain("{{core_settings}}");
  expect(DEFAULT_PROMPT_TEMPLATES.units).not.toContain("{{first_volume_outline}}");
  expect(DEFAULT_PROMPT_TEMPLATES.units).toContain("{{range_start}}");
  expect(DEFAULT_PROMPT_TEMPLATES.units).toContain("{{range_end}}");
});
```

- [ ] **Step 2: Run the focused test and verify the new assertion fails**

Run the Task 1 focused test command.

Expected: FAIL because `DEFAULT_PROMPT_TEMPLATES.units` still contains both background placeholders.

- [ ] **Step 3: Remove exactly the two opening blocks from the default**

Change the `units` value so it begins with the existing line:

```ts
units: `现在基于第1卷大纲，将第{{range_start}}-{{range_end}}章细分为一个“剧情单元”，包含5章左右的剧情量。
```

Keep every following instruction in the existing template unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the Task 1 focused test command.

Expected: all tests in the file pass.

- [ ] **Step 5: Commit the default-template change**

```powershell
git add src/modules/novels/templates.ts src/modules/novels/unit-template-migration.test.ts
git commit -m "feat: shorten default unit prompt"
```

### Task 3: Migrate schemes and novel snapshots during initialization

**Files:**
- Modify: `src/lib/novel-db/index.ts`
- Modify: `src/lib/novel-db/index.test.ts`

- [ ] **Step 1: Write a failing database migration test**

Add a test that initializes an in-memory database, inserts one custom scheme `units` template and one novel `units` snapshot using the legacy prefix, calls `initializeNovelDatabase(sqlite)` again, and asserts:

```ts
expect(systemTemplate.template).not.toContain("{{core_settings}}");
expect(customTemplate.template).toBe(suffix);
expect(novelTemplate.template).toBe(suffix);
```

Call `initializeNovelDatabase(sqlite)` a third time and assert the same exact values to prove idempotence. Use complete valid rows for `prompt_schemes`, `novels`, `prompt_scheme_templates`, and `prompt_templates`, with timestamps set to `1`.

- [ ] **Step 2: Run the database test and verify it fails**

Run:

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\vitest\vitest.mjs' run src/lib/novel-db/index.test.ts
```

Expected: FAIL because existing custom and snapshot templates retain the legacy prefix.

- [ ] **Step 3: Add the initialization migration**

Import `removeUnitPromptBackground` and add this function in `src/lib/novel-db/index.ts`:

```ts
export function migrateUnitPromptTemplates(sqlite: Database.Database) {
  const migrateTable = (table: "prompt_scheme_templates" | "prompt_templates") => {
    const rows = sqlite.prepare(`select id, template from ${table} where key = ?`).all("units") as Array<{ id: string; template: string }>;
    const update = sqlite.prepare(`update ${table} set template = ?, updated_at = ? where id = ?`);
    const migrate = sqlite.transaction(() => {
      for (const row of rows) {
        const template = removeUnitPromptBackground(row.template);
        if (template !== row.template) update.run(template, Date.now(), row.id);
      }
    });
    migrate();
  };

  migrateTable("prompt_scheme_templates");
  migrateTable("prompt_templates");
}
```

Call it after `seedDefaultPromptScheme(sqlite)` inside `initializeNovelDatabase`.

- [ ] **Step 4: Run the database and full unit tests**

Run:

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\vitest\vitest.mjs' run src/lib/novel-db/index.test.ts
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\vitest\vitest.mjs' run
```

Expected: database migration tests pass and the full suite has no failures.

- [ ] **Step 5: Commit the database migration**

```powershell
git add src/lib/novel-db/index.ts src/lib/novel-db/index.test.ts
git commit -m "feat: migrate stored unit prompts"
```

### Task 4: Verify the complete workbench

**Files:**
- Modify only if verification exposes a defect in files already in scope.

- [ ] **Step 1: Run type checking**

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\typescript\bin\tsc' --noEmit
```

Expected: exit code 0.

- [ ] **Step 2: Run ESLint**

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\eslint\bin\eslint.js' .
```

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

```powershell
& 'C:\Users\26798\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\next\dist\bin\next' build
```

Expected: build succeeds and `/novels` routes are generated.

- [ ] **Step 4: Inspect the final diff and status**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended tracked changes remain before the final commit or push.
