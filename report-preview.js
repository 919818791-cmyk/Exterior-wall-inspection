const REPORT_PREVIEW_DIALOG_ID = "report-dialog";
const DEFAULT_REPORT_URL = "示例报告.pdf";

const ensureReportDialog = () => {
  let dialog = document.querySelector(`#${REPORT_PREVIEW_DIALOG_ID}`);
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.className = "project-dialog report-dialog";
  dialog.id = REPORT_PREVIEW_DIALOG_ID;
  dialog.innerHTML = `
    <div class="report-dialog-heading">
      <div>
        <h2 id="report-title">示例报告PDF</h2>
        <span id="report-subtitle">建筑外墙巡检智能报告</span>
      </div>
      <div class="report-header-actions">
        <a class="button secondary" id="export-report-button" href="${DEFAULT_REPORT_URL}" download="示例报告.pdf"><i data-lucide="download" aria-hidden="true"></i>导出PDF</a>
        <button class="icon-button" type="button" data-close-report aria-label="关闭"><i data-lucide="x" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="report-preview" id="report-preview" aria-label="报告预览内容"></div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelector("[data-close-report]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return dialog;
};

const renderReportPreview = ({ title, subtitle, url }) => {
  const dialog = ensureReportDialog();
  const frame = document.createElement("iframe");
  frame.className = "report-pdf-frame";
  frame.src = url;
  frame.title = title;

  dialog.querySelector("#report-title").textContent = title;
  dialog.querySelector("#report-subtitle").textContent = subtitle;
  dialog.querySelector("#export-report-button").href = url;
  dialog.querySelector("#report-preview").replaceChildren(frame);
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2.1 } });
  dialog.showModal();
};

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-report-preview]");
  if (!trigger) return;

  event.preventDefault();
  renderReportPreview({
    title: trigger.dataset.reportTitle || "示例报告PDF",
    subtitle: trigger.dataset.reportSubtitle || "建筑外墙巡检智能报告",
    url: trigger.dataset.reportUrl || trigger.getAttribute("href") || DEFAULT_REPORT_URL,
  });
});
