/* global chrome, DropMindDeliveryFormat, DropMindFanqiePublisher */

const HOST_ID = "dropmind-fanqie-delivery-host";
const AUTO_START_HASH = "#dropmind-auto";
let activeJob = null;
let minimized = false;
let publishing = false;
let autoOrchestrating = false;

const { normalizeText, escapeHtml, bodyText, bodyHtml } = DropMindDeliveryFormat;
const { publishSucceeded, runPublishFlow } = DropMindFanqiePublisher;

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response?.ok) { reject(new Error(response?.error || "扩展操作失败")); return; }
      resolve(response);
    });
  });
}

function visible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 40 && rect.height > 18;
}

function fieldDescription(element) {
  return [element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("name"), element.id, element.className].filter(Boolean).join(" ");
}

function findTitleField() {
  const candidates = [...document.querySelectorAll("input,textarea")].filter(visible).filter((element) => element.type !== "hidden");
  return candidates.map((element) => {
    const description = fieldDescription(element);
    let score = 0;
    if (/章节名|章节标题|章名/.test(description)) score += 20;
    if (/标题/.test(description)) score += 8;
    if (element.tagName === "INPUT") score += 3;
    if (Number(element.getAttribute("maxlength") || 0) > 0 && Number(element.getAttribute("maxlength")) <= 100) score += 2;
    return { element, score };
  }).sort((left, right) => right.score - left.score).find((item) => item.score >= 8)?.element || null;
}

function findChapterNumberField(titleField) {
  const candidates = [...document.querySelectorAll("input,textarea")].filter(visible).filter((element) => element !== titleField && element.type !== "hidden");
  const titleRect = titleField?.getBoundingClientRect();
  return candidates.map((element) => {
    const description = fieldDescription(element).toLowerCase();
    const rect = element.getBoundingClientRect();
    const maxLength = Number(element.getAttribute("maxlength") || 0);
    const numericHint = `${element.getAttribute("inputmode") || ""} ${element.getAttribute("pattern") || ""}`;
    let nearbyText = "";
    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
      const ancestorRect = ancestor.getBoundingClientRect();
      if (ancestorRect.height <= 160 && ancestorRect.width <= 900) nearbyText += normalizeText(ancestor.textContent);
    }
    let score = 0;
    if (/章节序号|章节号|章序|章数|第几章|chapter.?number|serial/.test(description)) score += 30;
    if (element.type === "number") score += 14;
    if (/numeric|decimal|\[0-9\]|\\d/.test(numericHint)) score += 10;
    if (nearbyText.includes("第") && nearbyText.includes("章")) score += 12;
    if (titleRect && Math.abs(rect.top - titleRect.top) < 45 && rect.left < titleRect.left) score += 16;
    if (rect.width > 35 && rect.width < 180) score += 6;
    if (maxLength > 0 && maxLength <= 4) score += 5;
    if (/标题|title/.test(description)) score -= 15;
    return { element, score };
  }).sort((left, right) => right.score - left.score).find((item) => item.score >= 12)?.element || null;
}

function findBodyField() {
  const candidates = [...document.querySelectorAll("textarea,[contenteditable='true']")].filter(visible);
  return candidates.map((element) => {
    const description = fieldDescription(element);
    const rect = element.getBoundingClientRect();
    let score = Math.min(10, Math.floor(rect.height / 80));
    if (/正文|内容|editor|prosemirror|rich/.test(description.toLowerCase())) score += 15;
    if (element.getAttribute("contenteditable") === "true") score += 6;
    if (element.tagName === "TEXTAREA" && Number(element.getAttribute("rows") || 0) >= 10) score += 6;
    return { element, score };
  }).sort((left, right) => right.score - left.score).find((item) => item.score >= 8)?.element || null;
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value); else element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setEditableValue(element, value) {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  const inserted = document.execCommand("insertText", false, bodyText(value));
  if (!inserted || normalizeText(element.innerText) !== normalizeText(value)) {
    element.innerHTML = bodyHtml(value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findCreateButton(bookName) {
  const title = [...document.querySelectorAll("h1,h2,h3,h4,p,span,div")].filter(visible).find((element) => normalizeText(element.textContent) === normalizeText(bookName));
  if (!title) return null;
  let container = title;
  for (let depth = 0; depth < 9 && container; depth += 1, container = container.parentElement) {
    const button = [...container.querySelectorAll("button,a")].filter(visible).find((element) => normalizeText(element.textContent).includes("创建章节"));
    if (button) return button;
  }
  return null;
}

function editorFieldsReady() {
  const titleField = findTitleField();
  return Boolean(titleField && findChapterNumberField(titleField) && findBodyField());
}

function waitForPage(find, description, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const result = find();
      if (result) { resolve(result); return; }
      if (Date.now() - started >= timeout) { reject(new Error(`等待${description}超时`)); return; }
      setTimeout(tick, 220);
    };
    tick();
  });
}

function consumeAutoStartHash() {
  if (location.hash !== AUTO_START_HASH && !location.hash.startsWith(`${AUTO_START_HASH}=`)) return null;
  const jobId = location.hash.startsWith(`${AUTO_START_HASH}=`) ? decodeURIComponent(location.hash.slice(AUTO_START_HASH.length + 1)) : "";
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return jobId;
}

async function fillCurrentPage(setMessage) {
  if (!activeJob) throw new Error("请先领取待投递章节");
  const titleField = findTitleField();
  const chapterNumberField = findChapterNumberField(titleField);
  const bodyField = findBodyField();
  if (!chapterNumberField || !titleField || !bodyField) throw new Error("没有完整识别到章数、章节标题或正文编辑器，请先进入番茄的创建章节页面");
  setNativeValue(chapterNumberField, String(activeJob.chapterNumber));
  setNativeValue(titleField, activeJob.chapterTitle);
  if (bodyField instanceof HTMLTextAreaElement) setNativeValue(bodyField, bodyText(activeJob.chapterContent));
  else setEditableValue(bodyField, activeJob.chapterContent);
  if (Number(chapterNumberField.value) !== Number(activeJob.chapterNumber)) throw new Error(`章数填入后校验失败，请手动输入 ${activeJob.chapterNumber}`);
  if (normalizeText(titleField.value) !== normalizeText(activeJob.chapterTitle)) throw new Error("标题填入后校验失败，请使用复制标题按钮手动粘贴");
  if (normalizeText(bodyField.value || bodyField.innerText).length < Math.max(20, normalizeText(activeJob.chapterContent).length * 0.9)) throw new Error("正文填入后校验失败，请使用复制正文按钮手动粘贴");
  await send({ type: "update-status", jobId: activeJob.id, status: "filled", chapterContent: activeJob.chapterContent });
  activeJob = { ...activeJob, status: "filled" };
  setMessage("章数、标题和正文已填入；检查后可自动发布本章");
}

async function continueAutomaticDelivery(panel) {
  if (autoOrchestrating) return;
  const autoResult = await send({ type: "get-auto-run" });
  let autoRun = autoResult.autoRun;
  if (!autoRun?.enabled) return;
  autoOrchestrating = true;
  publishing = true;
  panel.render();
  try {
    if (Date.now() - Number(autoRun.startedAt || 0) > 10 * 60 * 1000) throw new Error("自动投递任务已超过 10 分钟，请从工作台重新打开番茄后台");
    const activeResult = await send({ type: "get-active" });
    activeJob = activeResult.job;

    if (autoRun.phase === "confirming" && activeJob) {
      panel.setMessage("页面已跳转，正在确认发布结果…");
      await waitForPage(() => publishSucceeded(autoRun.previousUrl), "番茄发布结果", 30000);
      await send({ type: "update-status", jobId: activeJob.id, status: "submitted" });
      activeJob = null;
      panel.setMessage("本章已自动发布，DropMind 状态已更新");
      return;
    }

    if (!activeJob) {
      panel.setMessage("正在自动领取待投递章节…");
      const claimed = await send({ type: "claim-next", jobId: autoRun.jobId });
      activeJob = claimed.job;
    }
    if (!activeJob) throw new Error("当前没有待投递章节，请先在 DropMind 将本章加入队列");
    autoRun = (await send({ type: "update-auto-run", phase: "claimed", jobId: activeJob.id })).autoRun;
    panel.render();

    const pageTarget = await waitForPage(() => {
      if (editorFieldsReady()) return { kind: "editor" };
      const createButton = findCreateButton(activeJob.targetBookName);
      return createButton ? { kind: "create", button: createButton } : null;
    }, "作品的创建章节入口或章节编辑器", 30000);

    let openedEditor = false;
    if (pageTarget.kind === "create") {
      panel.setMessage(`已领取第 ${activeJob.chapterNumber} 章，正在打开创建章节…`);
      await send({ type: "update-auto-run", phase: "opening-editor", jobId: activeJob.id });
      pageTarget.button.click();
      openedEditor = true;
      await waitForPage(editorFieldsReady, "章节编辑器加载", 45000);
    }

    if (openedEditor || activeJob.status !== "filled") {
      panel.setMessage("正在自动填入章数、标题和正文…");
      await send({ type: "update-auto-run", phase: "filling", jobId: activeJob.id });
      await fillCurrentPage(panel.setMessage);
      panel.render();
    }

    const job = activeJob;
    await send({ type: "update-auto-run", phase: "publishing", jobId: job.id });
    await runPublishFlow({
      publishDate: job.publishDate,
      onProgress: panel.setMessage,
      onBeforeConfirm: async ({ previousUrl }) => {
        await send({ type: "update-auto-run", phase: "confirming", jobId: job.id, previousUrl });
      },
    });
    await send({ type: "update-status", jobId: job.id, status: "submitted" });
    activeJob = null;
    panel.setMessage("本章已自动发布，DropMind 状态已更新");
  } catch (error) {
    await send({ type: "clear-auto-run" }).catch(() => null);
    panel.setMessage(`${error.message}\n自动投递已停止，任务和正文仍然保留。`, true);
  } finally {
    autoOrchestrating = false;
    publishing = false;
    panel.render();
  }
}

function createPanel() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial}.panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:330px;border:1px solid #315e4d;background:#f5f7f2;color:#20211e;box-shadow:0 14px 40px rgba(0,0,0,.22);font:13px/1.5 "Microsoft YaHei",sans-serif}.head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;background:#173f31;color:white}.head strong{font-size:14px}.head button{padding:2px 7px;border:1px solid rgba(255,255,255,.45);background:transparent;color:white;cursor:pointer}.body{display:grid;gap:10px;padding:13px}.body.hidden{display:none}.job{padding:10px;border:1px solid #c8d3c9;background:white}.job strong,.job span{display:block}.job span{margin-top:3px;color:#68716b;font-size:12px}.actions{display:flex;gap:7px;flex-wrap:wrap}.actions button{padding:8px 10px;border:1px solid #bbb8ae;background:white;color:#20211e;font-weight:700;cursor:pointer}.actions button.primary{background:#173f31;color:white;border-color:#173f31}.actions button:disabled{opacity:.45;cursor:not-allowed}.message{padding:9px;border:1px solid #c8d3c9;background:#e7efe9;color:#315e4d;white-space:pre-wrap}.message.error{border-color:#dfb2a9;background:#fff2ef;color:#9f3026}.empty{color:#68716b}.hint{color:#68716b;font-size:11px}
  </style><section class="panel"><header class="head"><strong>DropMind 番茄投递</strong><button type="button" data-action="minimize">—</button></header><div class="body"><div data-slot="job" class="empty">尚未领取章节</div><div class="actions"><button type="button" class="primary" data-action="claim">领取下一章</button><button type="button" data-action="open" disabled>进入创建章节</button><button type="button" data-action="fill" disabled>填入页面</button><button type="button" class="primary" data-action="auto-publish" disabled>自动发布本章</button></div><div class="actions"><button type="button" data-action="copy-number" disabled>复制章数</button><button type="button" data-action="copy-title" disabled>复制标题</button><button type="button" data-action="copy-body" disabled>复制正文</button><button type="button" data-action="submitted" disabled>我已提交审核</button><button type="button" data-action="abandon" disabled>放弃任务</button></div><div data-slot="message" hidden></div><div class="hint">从 DropMind 点击“打开后台并自动投递”后，无需再点本面板；遇到未识别界面会停止并保留任务。</div></div></section>`;
  const body = root.querySelector(".body");
  const jobSlot = root.querySelector("[data-slot='job']");
  const messageSlot = root.querySelector("[data-slot='message']");
  const buttons = Object.fromEntries([...root.querySelectorAll("[data-action]")].map((button) => [button.dataset.action, button]));

  function setMessage(message, error = false) {
    messageSlot.hidden = !message;
    messageSlot.textContent = message;
    messageSlot.className = `message${error ? " error" : ""}`;
  }

  function render() {
    if (!activeJob) {
      jobSlot.className = "empty"; jobSlot.textContent = "尚未领取章节";
      for (const name of ["open", "fill", "auto-publish", "copy-number", "copy-title", "copy-body", "submitted", "abandon"]) buttons[name].disabled = true;
      buttons.claim.disabled = false;
      return;
    }
    jobSlot.className = "job";
    jobSlot.innerHTML = `<strong>第 ${Number(activeJob.chapterNumber)} 章《${escapeHtml(activeJob.chapterTitle)}》</strong><span>${escapeHtml(activeJob.novelName)} → ${escapeHtml(activeJob.targetBookName)}</span><span>${activeJob.publishDate ? `${escapeHtml(activeJob.publishDate)} 12:00 · ` : ""}${Number(activeJob.contentLength)} 字符 · ${activeJob.status === "filled" ? "已填入" : "已领取"}</span>`;
    buttons.claim.disabled = true;
    for (const name of ["open", "fill", "copy-number", "copy-title", "copy-body"]) buttons[name].disabled = publishing;
    buttons["auto-publish"].disabled = publishing || activeJob.status !== "filled" || !activeJob.publishDate;
    buttons.submitted.disabled = publishing || activeJob.status !== "filled";
    buttons.abandon.disabled = publishing;
  }

  buttons.minimize.addEventListener("click", () => { minimized = !minimized; body.classList.toggle("hidden", minimized); buttons.minimize.textContent = minimized ? "+" : "—"; });
  buttons.claim.addEventListener("click", async () => { try { setMessage("正在领取…"); const result = await send({ type: "claim-next" }); activeJob = result.job; setMessage(activeJob ? "已领取，请进入对应作品的创建章节页面" : "当前没有待投递章节"); render(); } catch (error) { setMessage(error.message, true); } });
  buttons.open.addEventListener("click", () => { try { const button = findCreateButton(activeJob.targetBookName); if (button) { button.click(); setMessage("已打开创建章节；页面加载完成后点击“填入页面”"); return; } if (!location.href.startsWith(activeJob.targetManageUrl)) { location.href = activeJob.targetManageUrl; return; } throw new Error(`未找到作品“${activeJob.targetBookName}”的创建章节按钮，请手动进入该作品编辑页`); } catch (error) { setMessage(error.message, true); } });
  buttons.fill.addEventListener("click", async () => { try { setMessage("正在填写并校验…"); await fillCurrentPage(setMessage); render(); } catch (error) { setMessage(error.message, true); } });
  buttons["auto-publish"].addEventListener("click", async () => {
    if (!activeJob || publishing) return;
    try {
      await send({ type: "begin-auto-run", jobId: activeJob.id });
      await send({ type: "update-auto-run", phase: "publishing", jobId: activeJob.id });
      await continueAutomaticDelivery({ setMessage, render });
    } catch (error) {
      setMessage(error.message, true);
    }
  });
  buttons["copy-number"].addEventListener("click", async () => { try { await navigator.clipboard.writeText(String(activeJob.chapterNumber)); setMessage("章数已复制"); } catch { setMessage("章数复制失败", true); } });
  buttons["copy-title"].addEventListener("click", async () => { try { await navigator.clipboard.writeText(activeJob.chapterTitle); setMessage("标题已复制"); } catch { setMessage("标题复制失败", true); } });
  buttons["copy-body"].addEventListener("click", async () => { try { await navigator.clipboard.writeText(bodyText(activeJob.chapterContent)); setMessage("正文已复制（已去除多余空行）"); } catch { setMessage("正文复制失败", true); } });
  buttons.submitted.addEventListener("click", async () => { try { await send({ type: "update-status", jobId: activeJob.id, status: "submitted" }); activeJob = null; setMessage("已回写“提交审核”；可回 DropMind 刷新状态"); render(); } catch (error) { setMessage(error.message, true); } });
  buttons.abandon.addEventListener("click", async () => { const job = activeJob; try { await send({ type: "update-status", jobId: job.id, status: "failed", error: "作者在扩展中放弃本次填入" }); } catch { await send({ type: "clear-active" }).catch(() => null); } activeJob = null; setMessage("已放弃当前任务，可回 DropMind 重新加入队列"); render(); });

  render();
  return { setMessage, render };
}

async function initialize() {
  const panel = createPanel();
  if (!panel) return;
  try {
    const requestedJobId = consumeAutoStartHash();
    if (requestedJobId !== null) await send({ type: "begin-auto-run", jobId: requestedJobId });
    const result = await send({ type: "get-active" });
    activeJob = result.job;
    panel.render();
    await continueAutomaticDelivery(panel);
  } catch (error) {
    panel.setMessage(error.message, true);
  }
}

void initialize();
