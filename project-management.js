const projectTableBody = document.querySelector("#project-table-body");
const statusFilter = document.querySelector("#status-filter");
const projectSearch = document.querySelector("#project-search");
const projectEmpty = document.querySelector("#project-empty");
const footerCount = document.querySelector("#footer-count");
const projectToast = document.querySelector("#project-toast");
const STORAGE_KEY = "building-exterior-projects";
const OVERRIDE_STORAGE_KEY = "building-exterior-project-overrides";
const isReviewWorkbench = document.body.classList.contains("review-workbench-page");
const STATUS_META = {
  AI检测中: { filterValue: "检测中", label: "AI检测中", className: "detecting" },
  检测中: { filterValue: "检测中", label: "AI检测中", className: "detecting" },
  已出报告: { filterValue: "已出报告", label: "已出报告", className: "ready" },
  待检测: { filterValue: "待检测", label: "待检测", className: "neutral" },
  待上传: { filterValue: "待检测", label: "待检测", className: "neutral" },
};
const REVIEW_STATUS_META = {
  未审核: { filterValue: "未审核", label: "未审核", className: "detecting" },
  已审核: { filterValue: "已审核", label: "已审核", className: "reviewed" },
  已推送: { filterValue: "已推送", label: "已推送", className: "ready" },
};

const normalize = (value) => value.trim().toLocaleLowerCase("zh-CN");
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[character]));
const isPendingDetectionStatus = (status) => ["待检测", "待上传"].includes(status);
const isReviewableStatus = (status) => ["AI检测中", "检测中"].includes(status);
const isReportPendingPush = (project) => Boolean(project?.review?.reportGeneratedAt) && !project.review?.reportPushedAt && project?.status !== "已出报告";
const isReportPushed = (project) => project?.status === "已出报告" || Boolean(project?.review?.reportPushedAt);
const isReviewableProject = (project) => isReviewableStatus(project?.status) && !isReportPendingPush(project);
const isReviewWorkbenchProject = (project) => !isPendingDetectionStatus(project?.status);
const getProjectStatusMeta = (project) => {
  if (!isReviewWorkbench) return STATUS_META[project?.status] || STATUS_META["待检测"];
  if (isReportPushed(project)) return REVIEW_STATUS_META["已推送"];
  if (isReportPendingPush(project)) return REVIEW_STATUS_META["已审核"];
  return REVIEW_STATUS_META["未审核"];
};
const getProjectHref = (project) => {
  const params = new URLSearchParams({ id: project.id });
  if (isReviewWorkbench) params.set("review", "1");
  return `project-detail.html?${params.toString()}`;
};
const getActionLabel = (project) => {
  if (!isReviewWorkbench) return "查看详情";
  if (isReviewableProject(project)) return "开始审核";
  if (isReportPendingPush(project)) return "预览报告并推送";
  if (isReportPushed(project)) return "预览报告";
  return "查看详情";
};
const updateRowAction = (row, project) => {
  const actionCell = row.querySelector("td:last-child");
  if (!actionCell || !project?.id) return;
  const actionClass = isReviewWorkbench && (isReviewableProject(project) || isReportPendingPush(project)) ? " table-action-review" : "";
  actionCell.innerHTML = `<a class="table-action${actionClass}" href="${getProjectHref(project)}">${getActionLabel(project)}</a>`;
  actionCell.dataset.actionBound = "true";
};

const updateProjectList = () => {
  if (!projectTableBody) return;

  const status = statusFilter.value;
  const query = normalize(projectSearch.value);
  const rows = [...projectTableBody.querySelectorAll("tr")];

  let count = 0;
  rows.forEach((row) => {
    const matchesStatus = status === "all" || row.dataset.status === status;
    const matchesQuery = !query || normalize(row.textContent).includes(query);
    const visible = matchesStatus && matchesQuery;
    row.hidden = !visible;
    if (visible) count += 1;
  });

  projectEmpty.hidden = count !== 0;
  footerCount.textContent = count;
};

[statusFilter, projectSearch].forEach((control) => {
  control?.addEventListener(control === projectSearch ? "input" : "change", updateProjectList);
});

const createStoredProjectRow = (project) => {
  const createdAt = new Date(project.createdAt);
  const dateText = createdAt.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replaceAll("/", "-");
  const division = project.administrativeDivision || {};
  const locationText = `${division.city || ""}${division.district || ""}${project.location || ""}`;
  const status = getProjectStatusMeta(project);
  const row = document.createElement("tr");
  row.dataset.projectId = project.id;
  row.dataset.status = status.filterValue;
  row.dataset.created = project.createdAt;
  row.innerHTML = `
    <td data-label="项目名称"><strong>${escapeHTML(project.name)}</strong></td>
    <td data-label="建筑位置">${escapeHTML(locationText)}</td>
    <td data-label="当前状态"><span class="status-tag ${status.className}">${status.label}</span></td>
    <td data-label="更新时间">${dateText}</td>
    <td data-label="操作"></td>
  `;
  updateRowAction(row, project);
  return row;
};

const renderStoredProjects = () => {
  let projects = [];
  try {
    projects = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    projects = [];
  }
  if (!Array.isArray(projects)) return;
  projects.slice().reverse().filter((project) => !isReviewWorkbench || isReviewWorkbenchProject(project)).forEach((project) => projectTableBody.prepend(createStoredProjectRow(project)));
};

const applyBuiltInOverrides = () => {
  let overrides = {};
  try {
    overrides = JSON.parse(localStorage.getItem(OVERRIDE_STORAGE_KEY) || "{}");
  } catch (error) {
    overrides = {};
  }

  Object.entries(overrides).forEach(([projectId, project]) => {
    const row = projectTableBody.querySelector(`[data-project-id="${CSS.escape(projectId)}"]`);
    if (!row || !project) return;
    if (isReviewWorkbench && !isReviewWorkbenchProject(project)) {
      row.remove();
      return;
    }
    const cells = row.querySelectorAll("td");
    const division = project.administrativeDivision || {};
    const status = getProjectStatusMeta(project);
    cells[0].querySelector("strong").textContent = project.name;
    cells[1].textContent = `${division.city || ""}${division.district || ""}${project.location || ""}`;
    row.dataset.status = status.filterValue;
    cells[2].innerHTML = `<span class="status-tag ${status.className}">${status.label}</span>`;
    if (project.updatedAt) {
      cells[3].textContent = new Date(project.updatedAt).toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).replaceAll("/", "-");
    }
    updateRowAction(row, project);
  });
};

const syncStaticProjectActions = () => {
  projectTableBody.querySelectorAll("tr").forEach((row) => {
    const statusValue = row.dataset.status;
    const staticProject = {
      id: row.dataset.projectId,
      status: statusValue,
    };
    if (isReviewWorkbench && !isReviewWorkbenchProject(staticProject)) {
      row.remove();
      return;
    }
    if (row.querySelector("td:last-child")?.dataset.actionBound === "true") return;
    const status = getProjectStatusMeta(staticProject);
    row.dataset.status = status.filterValue;
    const statusCell = row.querySelector("td[data-label='当前状态']");
    if (statusCell) statusCell.innerHTML = `<span class="status-tag ${status.className}">${status.label}</span>`;
    updateRowAction(row, staticProject);
  });
};

let toastTimer;
const showToast = (message) => {
  if (!projectToast) return;
  clearTimeout(toastTimer);
  projectToast.textContent = message;
  projectToast.classList.add("is-visible");
  toastTimer = setTimeout(() => projectToast.classList.remove("is-visible"), 3000);
};

renderStoredProjects();
applyBuiltInOverrides();
syncStaticProjectActions();
updateProjectList();

if (new URLSearchParams(location.search).get("created") === "1") {
  showToast("项目已创建，下一步可上传巡检图像");
  history.replaceState({}, "", "project-management.html");
}
