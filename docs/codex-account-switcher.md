# Codex 桌面应用双账号切换工具

这个工具在两个已经由你本人登录过的 ChatGPT 账号之间切换 Codex 本地凭据。
两个账号继续使用同一个 `%USERPROFILE%\.codex` 目录，因此本地对话、项目记录、
配置和插件保持共享。

## 重要限制

- 每次登记或切换前，必须完全退出 Codex 桌面应用。
- 工具不会自动登录账号，也不会绕过 OpenAI 的使用限制。
- 本地对话可以共享，但云端任务、连接器、组织工作区和其他云端资源仍然归原账号所有。
- 凭据槽位包含访问令牌，敏感程度与 `%USERPROFILE%\.codex\auth.json` 相同。
  不要提交到 Git、发送给他人或粘贴到聊天中。
- 工具要求 Codex 使用文件形式保存凭据，即
  `%USERPROFILE%\.codex\auth.json` 必须存在。

## 工具位置

在仓库根目录打开 PowerShell。入口脚本是：

```text
tools\codex-account.ps1
```

查看当前登记状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 status
```

状态命令只显示槽位名称和登记状态，不显示令牌，也不会创建或修改文件。

## 首次登记账号 A

1. 在 Codex 桌面应用中登录第一个 ChatGPT Plus 账号。
2. 确认 Codex 可以正常发送消息。
3. 完全退出 Codex，包括系统托盘中的后台进程。
4. 在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 register A
```

脚本会将当前 `auth.json` 保存到 A 槽位，并将 A 标记为当前账号。

## 首次登记账号 B

1. 重新打开 Codex。
2. 在 Codex 中退出账号 A，然后通过官方登录页面登录账号 B。
3. 确认账号 B 可以正常发送消息。
4. 完全退出 Codex。
5. 运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 register B
```

现在两个账号都已登记。

## 日常切换账号

切换到账号 A：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 switch A
```

切换到账号 B：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 switch B
```

标准操作顺序：

1. 完全退出 Codex。
2. 运行 `switch A` 或 `switch B`。
3. 重新打开 Codex。
4. 检查应用中显示的账号，再继续工作。

切换时，工具会先把当前账号可能已自动刷新的令牌写回当前槽位，然后才载入目标
账号。这样可以减少频繁重新登录。

## 覆盖已登记账号

如果某个账号重新登录后生成了新凭据，可以完全退出 Codex，再使用 `-Force`
覆盖对应槽位：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\codex-account.ps1 register A -Force
```

将 `A` 换成 `B` 即可更新 B 槽位。

## 文件位置

账号切换文件保存在：

```text
%USERPROFILE%\.codex\account-switcher
```

主要文件：

- `auth.account-a.json`：账号 A 的凭据。
- `auth.account-b.json`：账号 B 的凭据。
- `active-account.txt`：当前槽位标记，不包含令牌。
- `backups\`：每次切换前自动保存的 `auth.json` 备份。

脚本会限制这些文件的 Windows ACL，只允许当前 Windows 用户访问。

## 手动回滚

如果切换后 Codex 无法登录：

1. 完全退出 Codex。
2. 打开 `%USERPROFILE%\.codex\account-switcher\backups`。
3. 选择切换前生成的最新备份。
4. 将它复制为 `%USERPROFILE%\.codex\auth.json`。
5. 重新打开 Codex。

如果备份也无法恢复，使用 Codex 官方退出和登录流程重新登录，再用
`register A -Force` 或 `register B -Force` 更新对应槽位。

## 常见错误

### Codex Desktop is running

Codex 仍有进程在运行。完全退出应用后重新执行。脚本不会强制结束 Codex，避免正在
运行的进程覆盖凭据。

### Credential file not found

当前没有 `%USERPROFILE%\.codex\auth.json`，或者目标账号尚未登记。先通过 Codex
官方界面登录，或者先运行对应的 `register A`、`register B`。

### Account A/B is already registered

对应槽位已存在。确认当前登录的是正确账号后，使用 `-Force` 明确覆盖。
