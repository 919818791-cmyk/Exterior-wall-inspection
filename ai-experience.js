const TRIAL_MAX_BYTES = 100 * 1024 * 1024;

const fileInput = document.querySelector("#trial-photo-input");
const uploadSummary = document.querySelector("#trial-upload-summary");
const photoList = document.querySelector("#trial-photo-list");
const resetButton = document.querySelector("#trial-reset-button");
const generateButton = document.querySelector("#trial-generate-button");
const reportEmpty = document.querySelector("#trial-report-empty");
const reportResult = document.querySelector("#trial-report-result");
const reportTime = document.querySelector("#trial-report-time");
const reportCount = document.querySelector("#trial-report-count");
const reportModels = document.querySelector("#trial-report-models");
const findingList = document.querySelector("#trial-finding-list");
const toast = document.querySelector("#trial-toast");
const modelInputs = [...document.querySelectorAll("[data-trial-model]")];

let selectedFiles = [];
let previewUrls = [];
let toastTimer;

const renderIcons = () => {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2.1 } });
};

const showToast = (message) => {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
};

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
};

const totalSize = (files) => files.reduce((sum, file) => sum + file.size, 0);

const selectedModels = () => modelInputs.filter((input) => input.checked).map((input) => input.value);

const clearPreviewUrls = () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
};

const renderPhotoList = () => {
  clearPreviewUrls();
  photoList.innerHTML = "";

  if (!selectedFiles.length) {
    uploadSummary.textContent = "尚未选择文件";
    photoList.innerHTML = '<div class="trial-photo-empty">暂无照片</div>';
    renderIcons();
    return;
  }

  const size = totalSize(selectedFiles);
  uploadSummary.textContent = `已选择 ${selectedFiles.length} 张 · ${formatBytes(size)}`;

  selectedFiles.slice(0, 8).forEach((file) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const item = document.createElement("article");
    item.className = "trial-photo-item";

    const image = document.createElement("img");
    image.src = url;
    image.alt = file.name;

    const meta = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);
    meta.append(name, size);

    item.append(image, meta);
    photoList.append(item);
  });

  if (selectedFiles.length > 8) {
    const more = document.createElement("div");
    more.className = "trial-photo-more";
    more.textContent = `还有 ${selectedFiles.length - 8} 张未展示`;
    photoList.append(more);
  }

  renderIcons();
};

const resetTrial = () => {
  selectedFiles = [];
  fileInput.value = "";
  reportResult.hidden = true;
  reportEmpty.hidden = false;
  renderPhotoList();
};

const acceptFiles = (files) => {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length !== files.length) showToast("仅支持图片文件");
  if (totalSize(images) > TRIAL_MAX_BYTES) {
    showToast("单次上传总量不能超过 100MB");
    fileInput.value = "";
    return;
  }
  selectedFiles = images;
  reportResult.hidden = true;
  reportEmpty.hidden = false;
  renderPhotoList();
};

const createFinding = (file, index, models) => {
  const primaryModel = models[index % models.length];
  const severity = index % 3 === 0 ? "需关注" : "疑似";
  const confidence = Math.min(96, 82 + ((file.name.length + index * 7) % 13));
  return {
    title: `${primaryModel}${severity}区域`,
    imageName: file.name,
    confidence,
  };
};

const generateReport = () => {
  if (!selectedFiles.length) {
    showToast("请先上传照片");
    fileInput.focus();
    return;
  }

  const models = selectedModels();
  if (!models.length) {
    showToast("请至少保留一种检测类型");
    return;
  }

  reportTime.textContent = new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replaceAll("/", "-");
  reportCount.textContent = String(selectedFiles.length);
  reportModels.textContent = models.join(" / ");

  findingList.innerHTML = "";
  selectedFiles.slice(0, 5).map((file, index) => createFinding(file, index, models)).forEach((finding) => {
    const item = document.createElement("article");
    item.className = "trial-finding-item";
    const title = document.createElement("span");
    title.textContent = finding.title;
    const confidence = document.createElement("strong");
    confidence.textContent = `${finding.confidence}%`;
    const imageName = document.createElement("em");
    imageName.textContent = finding.imageName;
    item.append(title, confidence, imageName);
    findingList.append(item);
  });

  reportEmpty.hidden = true;
  reportResult.hidden = false;
  showToast("简易报告已生成");
};

fileInput.addEventListener("change", (event) => acceptFiles([...event.target.files]));
resetButton.addEventListener("click", resetTrial);
generateButton.addEventListener("click", generateReport);
modelInputs.forEach((input) => {
  input.addEventListener("change", () => {
    input.closest(".trial-model-option")?.classList.toggle("is-selected", input.checked);
    if (!reportResult.hidden) generateReport();
  });
  input.closest(".trial-model-option")?.classList.toggle("is-selected", input.checked);
});

window.addEventListener("beforeunload", clearPreviewUrls);
renderPhotoList();
renderIcons();
