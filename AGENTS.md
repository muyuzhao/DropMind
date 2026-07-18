# DropMind 项目说明

## 项目定位

DropMind 是本地小说创作工作台，围绕选题、分卷大纲、核心设定、剧情单元、分章节大纲和章节正文组成固定创作流程。

- 项目只负责生成提示词、保存用户粘贴回来的模型输出和管理创作资料。
- 默认不调用 AI API，不增加账号系统、云同步或远程数据库。
- 不把其他彼此独立的个人工具并入本仓库。

## 技术栈与目录

- Node.js 24+、Next.js、React、TypeScript。
- SQLite 使用 `better-sqlite3`，数据访问代码主要位于 `src/lib/novel-db` 和 `src/modules/novels`。
- 页面与交互位于 `src/app` 和 `src/components`。
- 长期设计资料位于 `docs/specs`，阶段实施记录位于 `docs/plans`。

## 启动与验证

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

也可以双击 `start-novel-workbench.cmd` 启动开发环境。

## 数据与修改边界

- `data/novels.db` 和 `data/novel-projects` 包含用户的本地小说数据，不得提交到 Git。
- 修改数据库结构、备份格式或小说目录结构前必须先备份，并兼顾已有数据的迁移与兼容。
- 不主动修改、删除或格式化用户已有小说正文和资料文件。
- 修改六步工作流、提示词结构或批次范围逻辑时，应补充对应测试并验证现有小说仍可打开。
- 应用内 JSON 备份和正文 TXT 导出是主要可恢复路径，相关改动必须保持向后兼容或提供迁移说明。
