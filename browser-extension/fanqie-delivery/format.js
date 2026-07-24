(() => {
  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function bodyText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .replace(/\n[\t ]*\n+/g, "\n");
  }

  function bodyHtml(value) {
    const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "<p><br></p>";
    return normalized.split(/\n[\t ]*\n+/).map((paragraph) => {
      const lines = paragraph.split("\n").map((line) => line ? escapeHtml(line) : "<br>");
      return `<p>${lines.join("<br>")}</p>`;
    }).join("");
  }

  globalThis.DropMindDeliveryFormat = { normalizeText, escapeHtml, bodyText, bodyHtml };
})();
