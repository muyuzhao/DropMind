# Novel Rank Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers-subagent-driven-development (recommended) or superpowers:superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two prominent external ranking shortcuts to the `/novels` dashboard.

**Architecture:** Store the two immutable links in a small typed module so their URLs and labels can be unit tested. Render the list between the dashboard header and project list, using the existing CSS system with a responsive two-column layout.

**Tech Stack:** Next.js, React, TypeScript, Vitest, plain CSS.

---

### Task 1: Define and render ranking shortcuts

**Files:**
- Create: `src/modules/novels/rank-links.ts`
- Test: `src/modules/novels/rank-links.test.ts`
- Modify: `src/app/novels/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing link-definition test**

```ts
import { describe, expect, it } from "vitest";
import { NOVEL_RANK_LINKS } from "./rank-links";

describe("NOVEL_RANK_LINKS", () => {
  it("contains the official rank and trend tracker", () => {
    expect(NOVEL_RANK_LINKS.map((item) => item.href)).toEqual([
      "https://fanqienovel.com/rank",
      "https://fanqietools.com/?tab=trend",
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/modules/novels/rank-links.test.ts`

Expected: FAIL because `./rank-links` does not exist.

- [ ] **Step 3: Implement the immutable link definitions**

```ts
export const NOVEL_RANK_LINKS = [
  {
    title: "番茄小说官方排行榜",
    description: "查看男女频阅读榜、新书榜和分类榜。",
    action: "打开官方榜单",
    href: "https://fanqienovel.com/rank",
  },
  {
    title: "番茄工具站趋势",
    description: "查看女频新书上榜、掉榜、排名变化和阅读增长。",
    action: "打开趋势追踪",
    href: "https://fanqietools.com/?tab=trend",
  },
] as const;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/modules/novels/rank-links.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Render the cards on the dashboard**

Import `NOVEL_RANK_LINKS` in `src/app/novels/page.tsx` and render a `novel-rank-links` section immediately after the header. Each card must use a normal `<a>` with `target="_blank"` and `rel="noreferrer"`, displaying title, description, and action text.

- [ ] **Step 6: Add responsive card styles**

Add `.novel-rank-links` as a two-column grid, `.novel-rank-card` using the existing card colors and borders, and a media rule below 640px that switches the grid to one column.

- [ ] **Step 7: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0; the test suite contains the new passing rank-link test.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/novels/rank-links.ts src/modules/novels/rank-links.test.ts src/app/novels/page.tsx src/app/globals.css
git commit -m "feat: add novel rank shortcuts"
```
