# DropMind

DropMind 是一个个人 AI 工作收件箱：把零散文字、链接和文件投递进来，由 AI 自动理解、整理、提取待办，并在需要时帮助用户重新找到它们。

## 产品目标

第一阶段先验证一个最小闭环：

> 投递文本 → AI 生成标题、摘要、标签和待办 → 用户确认 → 保存 → 搜索回看

验收标准不是功能数量，而是能够连续一周真实使用，并且保存的信息之后可以找回来。

## 功能规划

### 第一阶段：最小可用闭环

- 文本快速投递
- AI 生成标题、摘要、类型、标签和优先级
- AI 提取待办，用户确认后生效
- 收件箱列表、详情、归档和收藏
- 标题、正文、摘要和标签的关键词搜索
- AI 调用状态和错误提示

### 第二阶段：知识管理

- 网页链接抓取
- PDF、图片上传和文本解析
- 内容切片与 Embedding
- 基于 pgvector 的语义搜索
- 基于资料的问答与来源引用

### 第三阶段：效率增强

- Redis/BullMQ 后台任务和失败重试
- 每日简报
- 浏览器插件和 PWA 快速投递
- 模型调用成本、Token 和延迟统计
- 数据导入、导出和备份

## 暂不实现

第一阶段不做复杂 Agent、多人协作、微信机器人、自动发送消息和多模型调度。先证明核心闭环确实有用。

## 技术架构

前期采用模块化单体，减少部署和调试成本。

```text
Browser
   │
   ▼
Next.js + TypeScript
   ├── App Router 页面
   ├── Route Handlers / Server Actions
   ├── 业务模块
   └── AI 调用层
          │
          ├── PostgreSQL
          ├── 模型 API
          └── 对象存储（第二阶段）
```

建议技术栈：

- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- PostgreSQL
- Drizzle ORM（也可以使用 Prisma）
- Zod：表单、API 和 AI 结构化输出校验
- Vitest：业务逻辑测试
- Playwright：核心流程端到端测试
- Docker Compose：本地 PostgreSQL

## 核心数据模型

### InboxItem

- `id`
- `rawContent`：原始文本
- `title`
- `summary`
- `contentType`
- `priority`
- `status`：`processing | ready | failed | archived`
- `isFavorite`
- `createdAt` / `updatedAt`

### Tag

- `id`
- `name`
- 与 InboxItem 的多对多关系

### Task

- `id`
- `sourceItemId`
- `title`
- `description`
- `dueAt`
- `priority`
- `status`：`suggested | todo | done | dismissed`

### AIJob

- `id`
- `itemId`
- `jobType`
- `status`
- `model`
- `inputTokens` / `outputTokens`
- `errorMessage`
- `createdAt` / `finishedAt`

## 建议目录

```text
src/
├── app/
│   ├── inbox/
│   ├── capture/
│   ├── tasks/
│   ├── search/
│   └── api/
├── components/
│   ├── inbox/
│   ├── tasks/
│   └── shared/
├── modules/
│   ├── capture/
│   ├── content-processing/
│   ├── inbox/
│   ├── tasks/
│   └── search/
├── lib/
│   ├── ai/
│   ├── db/
│   └── env/
├── prompts/
└── types/
```

页面负责展示和组合，业务规则放进 `modules`，模型厂商相关代码只放在 `lib/ai`，避免以后更换模型时改遍整个项目。

## 第一阶段

具体执行顺序、接口和验收标准见 [docs/PHASE-1.md](docs/PHASE-1.md)。

