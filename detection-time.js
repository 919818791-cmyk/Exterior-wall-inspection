const ORIENTATION_WINDOWS = {
  东: { primary: "07:30–09:00", backup: "16:00–17:00", summary: "上午低角度光线更稳定，适合东向立面连续采集" },
  南: { primary: "09:30–11:00", backup: "14:30–16:00", summary: "避开正午强反光，优先选择光照更均匀的过渡时段" },
  西: { primary: "15:30–17:00", backup: "08:00–09:00", summary: "下午光照条件更适合西向立面，风速风险较低" },
  北: { primary: "10:00–11:30", backup: "14:00–15:30", summary: "北向立面直射影响较小，可在温差稳定后采集" },
  东南: { primary: "08:00–10:00", backup: "15:30–16:30", summary: "上午光照稳定，适合东南向主立面采集" },
  东北: { primary: "08:30–10:00", backup: "14:00–15:30", summary: "上午反光较弱，可减少可见光照片过曝风险" },
  西南: { primary: "15:00–16:30", backup: "09:00–10:30", summary: "下午光线角度更合适，适合西南向立面补采" },
  西北: { primary: "14:30–16:00", backup: "10:00–11:00", summary: "午后光照更均匀，适合西北向立面巡检" },
};

const openButton = document.querySelector("#open-time-recommendation");
const dialog = document.querySelector("#time-recommendation-dialog");
const projectSelect = document.querySelector("#recommendation-project");
const dateInput = document.querySelector("#recommendation-date");
const orientationSelect = document.querySelector("#recommendation-orientation");
const results = document.querySelector("#time-recommendation-results");
const calculateButton = document.querySelector("#calculate-time-recommendation");
const primaryTime = document.querySelector("#primary-time");
const backupTime = document.querySelector("#backup-time");
const summary = document.querySelector("#recommendation-summary");
const resultOrientation = document.querySelector("#recommendation-result-orientation");

const renderIcons = () => {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2.1 } });
};

const resetResult = () => {
  results.hidden = true;
  calculateButton.textContent = "开始计算";
};

const openDialog = () => {
  dateInput.value ||= new Date().toISOString().slice(0, 10);
  resetResult();
  dialog.showModal();
};

const calculateRecommendation = () => {
  if (!projectSelect.value) {
    projectSelect.focus();
    return;
  }
  if (!dateInput.value) {
    dateInput.focus();
    return;
  }
  const result = ORIENTATION_WINDOWS[orientationSelect.value] || ORIENTATION_WINDOWS.东;
  primaryTime.textContent = result.primary;
  backupTime.textContent = result.backup;
  summary.textContent = `${projectSelect.selectedOptions[0].textContent} · ${dateInput.value} · ${result.summary}`;
  resultOrientation.textContent = orientationSelect.value;
  results.hidden = false;
  calculateButton.textContent = "重新计算";
};

openButton.addEventListener("click", openDialog);
calculateButton.addEventListener("click", calculateRecommendation);
[projectSelect, dateInput, orientationSelect].forEach((field) => {
  field.addEventListener("change", resetResult);
  field.addEventListener("input", resetResult);
});
document.querySelectorAll("[data-close-time-recommendation]").forEach((button) => {
  button.addEventListener("click", () => dialog.close());
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

renderIcons();
