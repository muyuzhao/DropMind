/* global chrome */

const DEFAULT_CONFIG = { baseUrl: "http://127.0.0.1:3000", token: "" };

async function getConfig() {
  const stored = await chrome.storage.local.get(["baseUrl", "token"]);
  return { baseUrl: String(stored.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, ""), token: String(stored.token || "") };
}

async function api(path, options = {}) {
  const config = await getConfig();
  if (!config.token) throw new Error("请先在扩展设置中填写连接令牌");
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-DropMind-Token": config.token, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `DropMind 返回 ${response.status}`);
  return payload;
}

async function handleMessage(message) {
  if (!message || typeof message.type !== "string") throw new Error("扩展消息无效");
  if (message.type === "get-config") return { ok: true, config: await getConfig() };
  if (message.type === "save-config") {
    const baseUrl = String(message.baseUrl || DEFAULT_CONFIG.baseUrl).trim().replace(/\/+$/, "");
    const token = String(message.token || "").trim();
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)) throw new Error("本机地址必须使用 127.0.0.1 或 localhost");
    if (!token) throw new Error("连接令牌不能为空");
    const current = await getConfig();
    await chrome.storage.local.set({ baseUrl, token });
    if (current.baseUrl !== baseUrl || current.token !== token) await chrome.storage.local.remove(["activeJob", "autoRun"]);
    return { ok: true, config: { baseUrl, token } };
  }
  if (message.type === "test-connection") return { ...(await api("/api/delivery/ping")), ok: true };
  if (message.type === "get-active") {
    const { activeJob = null } = await chrome.storage.local.get("activeJob");
    return { ok: true, job: activeJob };
  }
  if (message.type === "begin-auto-run") {
    const autoRun = { enabled: true, phase: "starting", jobId: String(message.jobId || ""), previousUrl: "", startedAt: Date.now(), updatedAt: Date.now() };
    await chrome.storage.local.set({ autoRun });
    return { ok: true, autoRun };
  }
  if (message.type === "get-auto-run") {
    const { autoRun = null } = await chrome.storage.local.get("autoRun");
    return { ok: true, autoRun };
  }
  if (message.type === "update-auto-run") {
    const { autoRun = null } = await chrome.storage.local.get("autoRun");
    if (!autoRun?.enabled) throw new Error("自动投递尚未启动");
    const next = {
      ...autoRun,
      phase: String(message.phase || autoRun.phase || "starting"),
      jobId: String(message.jobId || autoRun.jobId || ""),
      previousUrl: String(message.previousUrl || autoRun.previousUrl || ""),
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ autoRun: next });
    return { ok: true, autoRun: next };
  }
  if (message.type === "clear-auto-run") {
    await chrome.storage.local.remove("autoRun");
    return { ok: true };
  }
  if (message.type === "claim-next") {
    const requestedJobId = String(message.jobId || "");
    const { activeJob = null } = await chrome.storage.local.get("activeJob");
    if (activeJob) {
      if (requestedJobId && activeJob.id !== requestedJobId) throw new Error(`浏览器中仍保留第 ${activeJob.chapterNumber} 章任务，请先处理或放弃该任务`);
      return { ok: true, job: activeJob };
    }
    const query = requestedJobId ? `?jobId=${encodeURIComponent(requestedJobId)}` : "";
    const result = await api(`/api/delivery/next${query}`);
    if (result.job) {
      await chrome.storage.local.set({ activeJob: result.job });
      const { autoRun = null } = await chrome.storage.local.get("autoRun");
      if (autoRun?.enabled) await chrome.storage.local.set({ autoRun: { ...autoRun, jobId: result.job.id, phase: "claimed", updatedAt: Date.now() } });
    }
    return { ok: true, job: result.job };
  }
  if (message.type === "update-status") {
    const id = String(message.jobId || "");
    if (!id) throw new Error("投递任务不存在");
    const { activeJob = null } = await chrome.storage.local.get("activeJob");
    const result = await api(`/api/delivery/jobs/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status: message.status, error: message.error || "" }) });
    if (message.status === "submitted" || message.status === "failed") await chrome.storage.local.remove(["activeJob", "autoRun"]);
    else await chrome.storage.local.set({ activeJob: { ...activeJob, ...result.job, chapterContent: activeJob?.chapterContent || message.chapterContent || "" } });
    return { ok: true, job: result.job };
  }
  if (message.type === "clear-active") {
    await chrome.storage.local.remove(["activeJob", "autoRun"]);
    return { ok: true };
  }
  throw new Error("不支持的扩展操作");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "扩展操作失败" }));
  return true;
});
