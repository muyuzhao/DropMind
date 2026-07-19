(() => {
  const PUBLISH_PLAN = Object.freeze({
    typoAction: "提交",
    detectionAction: "仅基础检测",
    aiOption: "否",
    publishTime: "12:00",
  });

  const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 20 && rect.height > 14;
  }

  function validPublishDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function area(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function findButton(root, label) {
    const candidates = [...root.querySelectorAll("button,[role='button']")].filter(visible);
    return candidates.find((element) => normalize(element.textContent) === normalize(label))
      || candidates.find((element) => normalize(element.textContent).includes(normalize(label)))
      || null;
  }

  function findDialog(text) {
    const selectors = "[role='dialog'],[aria-modal='true'],[class*='modal'],[class*='dialog']";
    const semantic = [...document.querySelectorAll(selectors)]
      .filter(visible)
      .filter((element) => normalize(element.textContent).includes(normalize(text)))
      .sort((left, right) => area(left) - area(right));
    if (semantic[0]) return semantic[0];
    return [...document.querySelectorAll("section,div")]
      .filter(visible)
      .filter((element) => normalize(element.textContent).includes(normalize(text)) && element.querySelector("button,[role='button']"))
      .sort((left, right) => area(left) - area(right))[0] || null;
  }

  function waitFor(find, description, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const result = find();
        if (result) { resolve(result); return; }
        if (Date.now() - started >= timeout) { reject(new Error(`等待${description}超时，请检查番茄页面`)); return; }
        setTimeout(tick, 180);
      };
      tick();
    });
  }

  async function waitUntilChanged(element, previousText) {
    await waitFor(() => !element.isConnected || !visible(element) || !normalize(element.textContent).includes(normalize(previousText)), "页面进入下一步");
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findLeafByText(root, label) {
    return [...root.querySelectorAll("label,span,div")]
      .filter(visible)
      .filter((element) => normalize(element.textContent) === normalize(label))
      .sort((left, right) => area(left) - area(right))[0] || null;
  }

  async function chooseAiNo(dialog) {
    const aiText = findLeafByText(dialog, "是否使用AI");
    if (!aiText) throw new Error("没有识别到“是否使用AI”设置");
    let row = aiText.parentElement;
    for (let depth = 0; row && depth < 4; depth += 1, row = row.parentElement) {
      const noLabel = findLeafByText(row, PUBLISH_PLAN.aiOption);
      if (!noLabel) continue;
      const input = noLabel.matches("label") ? noLabel.querySelector("input[type='radio']") : noLabel.closest("label")?.querySelector("input[type='radio']");
      (input || noLabel).click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (input && !input.checked) throw new Error("“是否使用AI”未能切换为“否”");
      return;
    }
    throw new Error("没有识别到“是否使用AI”的“否”选项");
  }

  function findScheduleInput(dialog, kind) {
    const typed = dialog.querySelector(`input[type='${kind}']`);
    if (typed && visible(typed)) return typed;
    const pattern = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;
    const hint = kind === "date" ? /日期|date/i : /时间|time/i;
    const inputs = [...dialog.querySelectorAll("input")].filter(visible);
    const described = inputs.find((input) => hint.test([input.placeholder, input.getAttribute("aria-label"), input.name, input.id].filter(Boolean).join(" ")));
    if (described) return described;
    const label = findLeafByText(dialog, kind === "date" ? "日期" : "时间");
    let row = label?.parentElement;
    for (let depth = 0; row && depth < 3; depth += 1, row = row.parentElement) {
      const input = [...row.querySelectorAll("input")].filter(visible)[0];
      if (input) return input;
    }
    return inputs.find((input) => pattern.test(input.value)) || null;
  }

  async function ensureScheduleEnabled(dialog) {
    const currentDateInput = findScheduleInput(dialog, "date");
    if (currentDateInput && !currentDateInput.disabled) return;
    const label = findLeafByText(dialog, "定时发布");
    if (!label) throw new Error("没有识别到“定时发布”开关");
    let row = label.parentElement;
    for (let depth = 0; row && depth < 4; depth += 1, row = row.parentElement) {
      const control = row.querySelector("input[type='checkbox'],[role='switch'],[class*='switch']");
      if (!control) continue;
      control.click();
      await waitFor(() => {
        const dateInput = findScheduleInput(dialog, "date");
        return dateInput && !dateInput.disabled ? dateInput : null;
      }, "启用定时发布", 5000);
      return;
    }
    throw new Error("无法确认定时发布开关状态");
  }

  async function configurePublishing(dialog, publishDate) {
    await chooseAiNo(dialog);
    await ensureScheduleEnabled(dialog);
    const dateInput = findScheduleInput(dialog, "date");
    const timeInput = findScheduleInput(dialog, "time");
    if (!dateInput || !timeInput) throw new Error("没有识别到定时发布的日期或时间输入框");
    setNativeValue(dateInput, publishDate);
    setNativeValue(timeInput, PUBLISH_PLAN.publishTime);
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (dateInput.value !== publishDate) throw new Error(`发布日期填入失败，应为 ${publishDate}`);
    if (timeInput.value !== PUBLISH_PLAN.publishTime) throw new Error(`发布时间填入失败，应为 ${PUBLISH_PLAN.publishTime}`);
  }

  function publishSucceeded(previousUrl) {
    const pageText = normalize(document.body?.innerText);
    if (/发布成功|提交成功|已发布|审核中/.test(pageText)) return true;
    return location.href !== previousUrl && !findDialog("发布设置");
  }

  async function runPublishFlow({ publishDate, onProgress = () => {} }) {
    if (!validPublishDate(publishDate)) throw new Error("投递任务没有有效的发布日期，请回工作台重新加入队列");
    onProgress("正在进入发布检查…");
    const nextButton = await waitFor(() => findButton(document, "下一步"), "“下一步”按钮");
    nextButton.click();

    let settingsDialog = null;
    for (let step = 0; step < 4 && !settingsDialog; step += 1) {
      const stage = await waitFor(() => {
        const typo = findDialog("检测到你还有错别字未修改");
        if (typo) return { kind: "typo", dialog: typo };
        const detection = findDialog("请选择内容检测方式");
        if (detection) return { kind: "detection", dialog: detection };
        const settings = findDialog("发布设置");
        if (settings) return { kind: "settings", dialog: settings };
        return null;
      }, "发布检查弹窗");
      if (stage.kind === "settings") { settingsDialog = stage.dialog; break; }
      if (stage.kind === "typo") {
        onProgress("检测到错别字提示，正在选择继续提交…");
        const submit = findButton(stage.dialog, PUBLISH_PLAN.typoAction);
        if (!submit) throw new Error("错别字提示中没有识别到“提交”按钮");
        submit.click();
        await waitUntilChanged(stage.dialog, "检测到你还有错别字未修改");
      } else {
        onProgress("正在选择仅基础检测…");
        const basic = findButton(stage.dialog, PUBLISH_PLAN.detectionAction);
        if (!basic) throw new Error("没有识别到“仅基础检测”按钮");
        basic.click();
        await waitUntilChanged(stage.dialog, "请选择内容检测方式");
      }
    }
    if (!settingsDialog) settingsDialog = await waitFor(() => findDialog("发布设置"), "发布设置");

    onProgress(`正在设置 ${publishDate} 12:00 发布，AI 选择“否”…`);
    await configurePublishing(settingsDialog, publishDate);
    const confirm = findButton(settingsDialog, "确认发布");
    if (!confirm) throw new Error("没有识别到“确认发布”按钮");
    const previousUrl = location.href;
    confirm.click();
    onProgress("已确认发布，正在等待番茄返回结果…");
    await waitFor(() => publishSucceeded(previousUrl), "发布成功结果", 30000);
    return { submitted: true };
  }

  globalThis.DropMindFanqiePublisher = { PUBLISH_PLAN, validPublishDate, runPublishFlow };
})();
