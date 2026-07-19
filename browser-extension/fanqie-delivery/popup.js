/* global chrome */

const baseUrl = document.getElementById("baseUrl");
const token = document.getElementById("token");
const message = document.getElementById("message");

function send(payload) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
    if (!response?.ok) { reject(new Error(response?.error || "操作失败")); return; }
    resolve(response);
  }));
}

function showMessage(value, error = false) {
  message.hidden = false; message.textContent = value; message.className = error ? "error" : "";
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    showMessage("正在连接…");
    await send({ type: "save-config", baseUrl: baseUrl.value, token: token.value });
    await send({ type: "test-connection" });
    showMessage("连接成功，可以打开番茄作家后台投递");
  } catch (error) { showMessage(error.message, true); }
});

document.getElementById("show").addEventListener("click", () => { token.type = token.type === "password" ? "text" : "password"; });

send({ type: "get-config" }).then((result) => { baseUrl.value = result.config.baseUrl; token.value = result.config.token; }).catch((error) => showMessage(error.message, true));
