const reportTableBody = document.querySelector("#report-table-body");
const reportSearch = document.querySelector("#report-search");
const reportEmpty = document.querySelector("#report-empty");
const footerCount = document.querySelector("#footer-count");
const STORAGE_KEY = "building-exterior-projects";
const OVERRIDE_STORAGE_KEY = "building-exterior-project-overrides";
const REPORT_PDF_URL = "示例报告.pdf";
const BUILTIN_PROJECTS = [
  {
    id: "sunshine-garden",
    name: "阳光花园3栋外墙巡检",
    administrativeDivision: { city: "深圳市", district: "南山区" },
    location: "阳光花园 3 栋",
    status: "AI检测中",
    createdAt: "2026-06-18T14:30:00",
  },
  {
    id: "tech-park-a",
    name: "科技园A座年度巡检",
    administrativeDivision: { city: "广州市", district: "天河区" },
    location: "科韵路 16 号科技园 A 座",
    status: "已出报告",
    createdAt: "2026-06-17T18:20:00",
  },
  {
    id: "finance-center-b",
    name: "金融中心B塔复检项目",
    administrativeDivision: { city: "深圳市", district: "福田区" },
    location: "益田路 6003 号 B 塔",
    status: "AI检测中",
    createdAt: "2026-06-17T10:12:00",
  },
  {
    id: "huating-building-2",
    name: "华庭小区2号楼渗漏排查",
    administrativeDivision: { city: "上海市", district: "浦东新区" },
    location: "锦绣路 2888 弄 2 号楼",
    status: "待检测",
    createdAt: "2026-06-16T16:45:00",
  },
  {
    id: "city-plaza",
    name: "城市广场幕墙安全巡检",
    administrativeDivision: { city: "杭州市", district: "西湖区" },
    location: "文三路 478 号城市广场",
    status: "已出报告",
    createdAt: "2026-06-15T09:40:00",
  },
];

const parseStorage = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return parsed;
  } catch (error) {
    return fallback;
  }
};

const escapeHTML = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[character]));

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("zh-CN");

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待生成";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replaceAll("/", "-");
};

const getLocationText = (project) => {
  const division = project.administrativeDivision || {};
  return `${division.city || ""}${division.district || ""}${project.location || ""}` || "未填写";
};

const getReportTime = (project) => project.review?.reportGeneratedAt || project.updatedAt || project.createdAt;

const getReportName = (project) => `${project.name || "未命名项目"}检测报告`;

const getGeneratedReports = () => {
  const overrides = parseStorage(OVERRIDE_STORAGE_KEY, {});
  const storedProjects = parseStorage(STORAGE_KEY, []);
  const builtInProjects = BUILTIN_PROJECTS.map((project) => overrides[project.id] || project);
  const projects = [...builtInProjects, ...(Array.isArray(storedProjects) ? storedProjects : [])];

  return projects
    .filter((project) => project?.status === "已出报告")
    .sort((a, b) => new Date(getReportTime(b)).getTime() - new Date(getReportTime(a)).getTime());
};

const createReportRow = (project) => {
  const reportName = getReportName(project);
  const reportTimeText = formatDateTime(getReportTime(project));
  const row = document.createElement("tr");
  row.dataset.reportId = project.id || reportName;
  row.innerHTML = `
    <td data-label="报告名称"><strong>${escapeHTML(reportName)}</strong></td>
    <td data-label="关联项目">${escapeHTML(project.name || "未命名项目")}</td>
    <td data-label="建筑位置">${escapeHTML(getLocationText(project))}</td>
    <td data-label="生成时间">${reportTimeText}</td>
    <td data-label="操作"><a class="table-action" href="${REPORT_PDF_URL}" data-report-preview data-report-title="${escapeHTML(reportName)}" data-report-subtitle="${escapeHTML(`${project.name || "未命名项目"} · 报告生成时间 ${reportTimeText}`)}">查看报告</a></td>
  `;
  return row;
};

const updateReportList = () => {
  if (!reportTableBody) return;
  const query = normalize(reportSearch.value);
  const rows = [...reportTableBody.querySelectorAll("tr")];
  let count = 0;

  rows.forEach((row) => {
    const visible = !query || normalize(row.textContent).includes(query);
    row.hidden = !visible;
    if (visible) count += 1;
  });

  reportEmpty.hidden = count !== 0;
  footerCount.textContent = count;
};

const renderReports = () => {
  if (!reportTableBody) return;
  reportTableBody.replaceChildren(...getGeneratedReports().map(createReportRow));
  updateReportList();
};

reportSearch?.addEventListener("input", updateReportList);
renderReports();
