# 本地开发

## 环境要求

- Node.js 24 LTS
- Docker Desktop（用于本地 PostgreSQL）

## 启动

```bash
copy .env.example .env.local
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

打开 `http://localhost:3000/capture` 投递第一条内容。

## 质量检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 当前范围

当前实现第一阶段里程碑 0 和里程碑 1 的最短路径：

- 保存纯文本原文
- 收件箱倒序列表
- 内容详情
- 收藏与归档

AI 分析、任务确认和搜索将在后续里程碑接入。即使没有模型 API Key，以上功能也应始终可用。
