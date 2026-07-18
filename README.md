# DropMind

DropMind 是一个本地小说创作工作台，提供固定的六步创作流程：选题、分卷大纲、核心设定、剧情单元、分章节大纲和章节正文。

它不调用 AI API，只负责生成提示词、保存从 Gemini 等模型粘贴回来的内容，并提供 JSON 备份和正文 TXT 导出。

## 启动

要求安装 Node.js 24 或更高版本。

最简单的方式是双击：

```text
start-novel-workbench.cmd
```

也可以在 PowerShell 中运行：

```powershell
npm.cmd install
npm.cmd run dev
```

然后打开 `http://localhost:3000`。

## 数据与备份

本机数据保存在 `data/novels.db`，该目录不会提交到 Git。请定期在应用中使用“备份 JSON”；正文可以使用“导出正文 TXT”导出。

## 检查

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```
