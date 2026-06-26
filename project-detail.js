const STORAGE_KEY = "building-exterior-projects";
const OVERRIDE_STORAGE_KEY = "building-exterior-project-overrides";
const DEFAULT_POSITION = { lat: 22.5431, lng: 114.0579 };
const DEFAULT_FACADES = [
  { name: "东立面" },
  { name: "南立面" },
  { name: "西立面" },
  { name: "北立面" },
];
const PHOTO_TYPES = ["dji", "visible", "thermal"];
const PHOTO_TYPE_LABELS = { dji: "无人机照片", visible: "可见光图片", thermal: "热成像图片" };
const REPORT_PDF_URL = "示例报告.pdf";
const MODEL_TYPE_OPTIONS = [
  { id: "crack", name: "裂缝" },
  { id: "hollow", name: "空鼓" },
  { id: "spalling", name: "剥落" },
  { id: "leakage", name: "渗漏" },
  { id: "corrosion", name: "锈蚀" },
];
const REVIEW_SAMPLE_PHOTOS = [
  { id: "crack", name: "AI-001 裂缝疑似缺陷", src: "assets/defect-crack-hd.png" },
  { id: "spalling", name: "AI-002 剥落疑似缺陷", src: "assets/defect-spalling-hd.png" },
  { id: "hollow", name: "AI-003 空鼓疑似缺陷", src: "assets/defect-hollow-hd.png" },
  { id: "leakage", name: "AI-004 渗漏疑似缺陷", src: "assets/defect-leakage-hd.png" },
  { id: "corrosion", name: "AI-005 锈蚀疑似缺陷", src: "assets/defect-corrosion-hd.png" },
];

const createEmptyUploads = () => ({ model: "dji", dji: [], visible: [], thermal: [] });

const createPhotoId = (type, index = 0) => `${type}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;

const normalizePhotoRecord = (photo, type, index) => {
  if (typeof photo === "string") {
    return { id: `${type}-${index}-${photo}`, name: photo, src: "", mime: "", size: 0 };
  }
  return {
    id: photo?.id || createPhotoId(type, index),
    name: photo?.name || `未命名照片 ${index + 1}`,
    src: photo?.src || photo?.dataUrl || photo?.url || "",
    mime: photo?.mime || "",
    size: Number(photo?.size || 0),
  };
};

const normalizeUploads = (uploads = {}) => {
  const merged = { ...createEmptyUploads(), ...uploads };
  return {
    model: merged.model === "other" ? "other" : "dji",
    dji: (merged.dji || []).map((photo, index) => normalizePhotoRecord(photo, "dji", index)),
    visible: (merged.visible || []).map((photo, index) => normalizePhotoRecord(photo, "visible", index)),
    thermal: (merged.thermal || []).map((photo, index) => normalizePhotoRecord(photo, "thermal", index)),
  };
};

const createDefaultModelSettings = () => ({
  types: MODEL_TYPE_OPTIONS.map((option) => option.id),
  highPrecision: false,
});

const normalizeModelSettings = (settings) => {
  if (!settings) return createDefaultModelSettings();
  const validTypes = MODEL_TYPE_OPTIONS.map((option) => option.id);
  const modelTypes = Array.isArray(settings.types) ? settings.types.filter((type) => validTypes.includes(type)) : createDefaultModelSettings().types;
  const types = modelTypes.length ? modelTypes : createDefaultModelSettings().types;
  return { types, highPrecision: Boolean(settings.highPrecision) };
};

const REGION_DATA = {
  广东省: {
    深圳市: ["福田区", "罗湖区", "南山区", "盐田区", "宝安区", "龙岗区", "龙华区", "坪山区", "光明区"],
    广州市: ["越秀区", "海珠区", "荔湾区", "天河区", "白云区", "黄埔区", "番禺区", "花都区", "南沙区"],
    东莞市: ["东城街道", "南城街道", "万江街道", "莞城街道", "松山湖园区"],
  },
  北京市: { 北京市: ["东城区", "西城区", "朝阳区", "海淀区", "丰台区", "石景山区", "通州区"] },
  上海市: { 上海市: ["黄浦区", "徐汇区", "长宁区", "静安区", "浦东新区", "杨浦区", "闵行区"] },
  浙江省: {
    杭州市: ["上城区", "拱墅区", "西湖区", "滨江区", "萧山区", "余杭区"],
    宁波市: ["海曙区", "江北区", "北仑区", "镇海区", "鄞州区"],
  },
  江苏省: {
    南京市: ["玄武区", "秦淮区", "建邺区", "鼓楼区", "浦口区", "栖霞区"],
    苏州市: ["姑苏区", "虎丘区", "吴中区", "相城区", "吴江区"],
  },
};

const createFacade = (id, name) => ({
  id,
  name,
  uploads: createEmptyUploads(),
});

const createBuilding = (id, name, floors, height) => ({
  id,
  name,
  floors,
  height,
  facades: DEFAULT_FACADES.map((facade, index) => createFacade(`${id}-facade-${index + 1}`, facade.name)),
});

const BUILTIN_PROJECTS = {
  "sunshine-garden": {
    id: "sunshine-garden", name: "阳光花园3栋外墙巡检", administrativeDivision: { province: "广东省", city: "深圳市", district: "南山区" },
    location: "阳光花园 3 栋", client: "深圳市阳光物业管理有限公司", contact: "刘经理", phone: "0755-86661234",
    coordinates: { lat: 22.53332, lng: 113.93041 }, status: "AI检测中", createdAt: "2026-06-18T14:30:00",
    buildings: [createBuilding("sunshine-3", "阳光花园 3 栋", 32, 98.6), createBuilding("sunshine-podium", "商业裙楼", 5, 22.4)],
  },
  "tech-park-a": {
    id: "tech-park-a", name: "科技园A座年度巡检", administrativeDivision: { province: "广东省", city: "广州市", district: "天河区" },
    location: "科韵路 16 号科技园 A 座", client: "广州科技园运营有限公司", contact: "陈工", phone: "020-85661238",
    coordinates: { lat: 23.12463, lng: 113.37491 }, status: "已出报告", createdAt: "2026-06-17T18:20:00",
    buildings: [createBuilding("tech-a", "科技园 A 座", 28, 116)],
  },
  "finance-center-b": {
    id: "finance-center-b", name: "金融中心B塔复检项目", administrativeDivision: { province: "广东省", city: "深圳市", district: "福田区" },
    location: "益田路 6003 号 B 塔", client: "深圳金融中心物业服务有限公司", contact: "周经理", phone: "0755-88361299",
    coordinates: { lat: 22.54036, lng: 114.05652 }, status: "AI检测中", createdAt: "2026-06-17T10:12:00",
    buildings: [createBuilding("finance-b", "金融中心 B 塔", 48, 198.5)],
  },
  "huating-building-2": {
    id: "huating-building-2", name: "华庭小区2号楼渗漏排查", administrativeDivision: { province: "上海市", city: "上海市", district: "浦东新区" },
    location: "锦绣路 2888 弄 2 号楼", client: "上海华庭物业管理有限公司", contact: "王女士", phone: "021-58961205",
    coordinates: { lat: 31.20847, lng: 121.55062 }, status: "待检测", createdAt: "2026-06-16T16:45:00",
    buildings: [createBuilding("huating-2", "华庭小区 2 号楼", 18, 57.2)],
  },
  "city-plaza": {
    id: "city-plaza", name: "城市广场幕墙安全巡检", administrativeDivision: { province: "浙江省", city: "杭州市", district: "西湖区" },
    location: "文三路 478 号城市广场", client: "杭州城市广场商业管理有限公司", contact: "赵工", phone: "0571-87961228",
    coordinates: { lat: 30.27825, lng: 120.12311 }, status: "已出报告", createdAt: "2026-06-15T09:40:00",
    buildings: [createBuilding("city-plaza-main", "城市广场主楼", 26, 105.8)],
  },
};

const projectForm = document.querySelector("#project-detail-form");
const workspace = document.querySelector("#project-detail-workspace");
const notFound = document.querySelector("#project-not-found");
const buildingList = document.querySelector("#building-list");
const buildingTemplate = document.querySelector("#detail-building-template");
const facadeTemplate = document.querySelector("#detail-facade-template");
const addBuildingButton = document.querySelector("#add-building-button");
const saveProjectButton = document.querySelector("#save-project-button");
const startAIDetectionButton = document.querySelector("#start-ai-detection-button");
const returnListButton = document.querySelector(".detail-view-actions .button.secondary");
const structureSummary = document.querySelector("#structure-summary");
const provinceSelect = document.querySelector("#province");
const citySelect = document.querySelector("#city");
const districtSelect = document.querySelector("#district");
const projectLocation = document.querySelector("#project-location");
const longitudeInput = document.querySelector("#longitude");
const latitudeInput = document.querySelector("#latitude");
const locateButton = document.querySelector("#locate-button");
const resetMapButton = document.querySelector("#reset-map-button");
const mapStatus = document.querySelector("#map-status");
const projectToast = document.querySelector("#project-toast");
const uploadDialog = document.querySelector("#upload-dialog");
const uploadForm = document.querySelector("#upload-form");
const droneModel = document.querySelector("#drone-model");
const djiUploadSection = document.querySelector("#dji-upload-section");
const otherUploadSection = document.querySelector("#other-upload-section");
const photoManageDialog = document.querySelector("#photo-manage-dialog");
const photoFileList = document.querySelector("#photo-file-list");
const photoPreviewEmpty = document.querySelector("#photo-preview-empty");
const photoPreviewImage = document.querySelector("#photo-preview-image");
const deleteSelectedPhotoButton = document.querySelector("#delete-selected-photo");
const reviewDialog = document.querySelector("#review-dialog");
const reviewPhotoList = document.querySelector("#review-photo-list");
const reviewPreviewEmpty = document.querySelector("#review-preview-empty");
const reviewPreviewImage = document.querySelector("#review-preview-image");
const reviewEditButton = document.querySelector("#review-edit-button");
const reviewConfirmButton = document.querySelector("#review-confirm-button");
const reviewResetButton = document.querySelector("#review-reset-button");
const generateReportButton = document.querySelector("#generate-report-button");
const reportDialog = document.querySelector("#report-dialog");
const reportTitle = document.querySelector("#report-title");
const reportSubtitle = document.querySelector("#report-subtitle");
const reportPreview = document.querySelector("#report-preview");
const exportReportButton = document.querySelector("#export-report-button");
const pushReportButton = document.querySelector("#push-report-button");
const modelTypesControl = document.querySelector("#model-types");
const modelConfigPanel = modelTypesControl.closest(".model-config-panel");
const selectedModelCount = document.querySelector("#selected-model-count");
const modelTypesError = document.querySelector("#model-types-error");
const standardDetectionInput = document.querySelector("#standard-detection");
const highPrecisionInput = document.querySelector("#high-precision");

const urlParams = new URLSearchParams(location.search);
const projectId = urlParams.get("id");
const isReviewWorkbenchEntry = urlParams.get("review") === "1";
const shouldOpenReview = isReviewWorkbenchEntry;
let currentProject;
let isBuiltInProject = false;
let isEditing = false;
let map;
let marker;
let currentPosition = { ...DEFAULT_POSITION };
let buildingSequence = Date.now();
let facadeSequence = Date.now();
let toastTimer;
let activeFacadeId;
let activePhotoFacadeId;
let selectedPhotoId;
let selectedReviewPhotoId;
let reviewPhotos = [];
let pendingUploads = createEmptyUploads();
const facadeUploadState = new Map();

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const showToast = (message) => {
  clearTimeout(toastTimer);
  projectToast.textContent = message;
  projectToast.classList.add("is-visible");
  toastTimer = setTimeout(() => projectToast.classList.remove("is-visible"), 3200);
};

const renderIcons = () => {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2.1 } });
};

const applyNavigationContext = () => {
  const projectNav = document.querySelector('.main-nav a[href="project-management.html"]');
  const reviewNav = document.querySelector('.main-nav a[href="review-workbench.html"]');
  const targetHref = isReviewWorkbenchEntry ? "review-workbench.html" : "project-management.html";

  [projectNav, reviewNav].forEach((link) => {
    link?.classList.remove("active");
    link?.removeAttribute("aria-current");
  });

  const activeNav = isReviewWorkbenchEntry ? reviewNav : projectNav;
  activeNav?.classList.add("active");
  activeNav?.setAttribute("aria-current", "page");

  if (returnListButton) {
    returnListButton.href = targetHref;
    returnListButton.textContent = "返回列表";
  }

  const notFoundReturn = document.querySelector("#project-not-found a.button");
  if (notFoundReturn) {
    notFoundReturn.href = targetHref;
    notFoundReturn.textContent = isReviewWorkbenchEntry ? "返回审核工作台" : "返回项目列表";
  }
};

const isReportPendingPush = () => Boolean(currentProject?.review?.reportGeneratedAt) &&
  !currentProject.review?.reportPushedAt &&
  currentProject?.status !== "已出报告";
const isPendingDetection = () => ["待检测", "待上传"].includes(currentProject?.status);
const isDetectionReviewing = () => ["AI检测中", "检测中"].includes(currentProject?.status) && !isReportPendingPush();
const isReportReady = () => currentProject?.status === "已出报告" || Boolean(currentProject?.review?.reportPushedAt);
const canEditProject = () => isPendingDetection();

const updateDetailActionState = () => {
  const reviewing = isDetectionReviewing();
  const pendingPush = isReportPendingPush();
  const reportReady = isReportReady();
  saveProjectButton.hidden = !canEditProject();
  const reviewingActionVisible = isReviewWorkbenchEntry && (reviewing || pendingPush);
  startAIDetectionButton.disabled = false;
  startAIDetectionButton.classList.toggle("is-reviewing", reviewingActionVisible || reportReady);
  startAIDetectionButton.closest(".detail-view-actions")?.classList.toggle("is-reviewing", reviewingActionVisible || reportReady);
  if (reportReady) {
    startAIDetectionButton.innerHTML = '<i data-lucide="file-text" aria-hidden="true"></i>查看报告';
  } else if (pendingPush && isReviewWorkbenchEntry) {
    startAIDetectionButton.innerHTML = '<i data-lucide="send" aria-hidden="true"></i>预览报告并推送';
  } else if (reviewing && isReviewWorkbenchEntry) {
    startAIDetectionButton.innerHTML = '<i data-lucide="clipboard-check" aria-hidden="true"></i>开始审核';
  } else if (canEditProject()) {
    startAIDetectionButton.innerHTML = '<i data-lucide="scan-line" aria-hidden="true"></i>开始AI检测';
  } else {
    startAIDetectionButton.innerHTML = '<i data-lucide="loader-circle" aria-hidden="true"></i>检测中';
    startAIDetectionButton.disabled = true;
  }
  renderIcons();
};

const formatDateTime = (value) => {
  if (!value) return "待生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待生成";
  return date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replaceAll("/", "-");
};

const parseStorage = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return parsed;
  } catch (error) {
    return fallback;
  }
};

const normalizeProject = (project) => {
  const normalized = deepClone(project);
  if (normalized.status === "待上传") normalized.status = "待检测";
  normalized.coordinates ||= { ...DEFAULT_POSITION };
  normalized.administrativeDivision ||= { province: "广东省", city: "深圳市", district: "南山区" };
  normalized.modelSettings = normalizeModelSettings(normalized.modelSettings);
  normalized.buildings = (normalized.buildings || []).map((building, buildingIndex) => ({
    ...building,
    id: building.id || `building-${buildingIndex + 1}`,
    facades: (building.facades || []).map((facade, facadeIndex) => ({
      id: facade.id || `${building.id || `building-${buildingIndex + 1}`}-facade-${facadeIndex + 1}`,
      name: facade.name || `立面 ${facadeIndex + 1}`,
      uploads: normalizeUploads(facade.uploads),
    })),
  }));
  return normalized;
};

const loadProject = () => {
  const storedProjects = parseStorage(STORAGE_KEY, []);
  const stored = Array.isArray(storedProjects) ? storedProjects.find((project) => project.id === projectId) : undefined;
  if (stored) return normalizeProject(stored);
  const overrides = parseStorage(OVERRIDE_STORAGE_KEY, {});
  if (overrides[projectId]) {
    isBuiltInProject = true;
    return normalizeProject(overrides[projectId]);
  }
  if (BUILTIN_PROJECTS[projectId]) {
    isBuiltInProject = true;
    return normalizeProject(BUILTIN_PROJECTS[projectId]);
  }
  return undefined;
};

const persistProject = () => {
  currentProject.updatedAt = new Date().toISOString();
  try {
    if (isBuiltInProject) {
      const overrides = parseStorage(OVERRIDE_STORAGE_KEY, {});
      overrides[currentProject.id] = currentProject;
      localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
      return true;
    }
    const projects = parseStorage(STORAGE_KEY, []);
    const index = Array.isArray(projects) ? projects.findIndex((project) => project.id === currentProject.id) : -1;
    if (index >= 0) {
      projects[index] = currentProject;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      return true;
    }
  } catch (error) {
    showToast("本地存储空间不足，请减少照片后重试");
    return false;
  }
  return false;
};

const fillSelect = (select, values, selectedValue) => {
  select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
  if (values.includes(selectedValue)) select.value = selectedValue;
};

const updateCities = (preferredCity, preferredDistrict) => {
  const province = REGION_DATA[provinceSelect.value] ? provinceSelect.value : Object.keys(REGION_DATA)[0];
  const cities = Object.keys(REGION_DATA[province]);
  fillSelect(citySelect, cities, preferredCity);
  updateDistricts(preferredDistrict);
};

const updateDistricts = (preferredDistrict) => {
  const districts = REGION_DATA[provinceSelect.value]?.[citySelect.value] || [];
  fillSelect(districtSelect, districts, preferredDistrict);
};

provinceSelect.addEventListener("change", () => updateCities());
citySelect.addEventListener("change", () => updateDistricts());

const setCoordinates = ({ lat, lng }, statusText = "已从地图提取经纬度") => {
  currentPosition = { lat: Number(lat), lng: Number(lng) };
  latitudeInput.value = currentPosition.lat.toFixed(6);
  longitudeInput.value = currentPosition.lng.toFixed(6);
  mapStatus.textContent = statusText;
};

const initializeMap = (position) => {
  setCoordinates(position, "项目位置");
  if (!window.L) {
    document.querySelector("#project-map").classList.add("map-unavailable");
    mapStatus.textContent = "在线地图暂时无法加载";
    return;
  }
  map = L.map("project-map", { zoomControl: true }).setView([position.lat, position.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  marker = L.marker([position.lat, position.lng], { draggable: false }).addTo(map);
  marker.on("dragend", () => setCoordinates(marker.getLatLng(), "位置已手动调整"));
  map.on("click", (event) => {
    if (!isEditing) return;
    marker.setLatLng(event.latlng);
    setCoordinates(event.latlng, "位置已手动调整");
  });
};

const locateAddress = async () => {
  if (!isEditing) return;
  const address = projectLocation.value.trim();
  if (!address) {
    projectLocation.focus();
    showToast("请先填写项目位置");
    return;
  }
  locateButton.disabled = true;
  locateButton.querySelector("span").textContent = "定位中";
  const query = `${address}, ${districtSelect.value}, ${citySelect.value}, ${provinceSelect.value}, 中国`;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cn&q=${encodeURIComponent(query)}`, { headers: { "Accept-Language": "zh-CN" } });
    if (!response.ok) throw new Error("geocoding failed");
    const [result] = await response.json();
    if (!result) throw new Error("no result");
    const position = { lat: Number(result.lat), lng: Number(result.lon) };
    setCoordinates(position, "定位成功");
    marker?.setLatLng(position);
    map?.flyTo(position, 17, { duration: 0.8 });
  } catch (error) {
    showToast("暂未找到该位置，请完善地址后重试");
  } finally {
    locateButton.disabled = !isEditing;
    locateButton.querySelector("span").textContent = "定位";
  }
};

locateButton.addEventListener("click", locateAddress);
resetMapButton.addEventListener("click", () => {
  if (map && marker) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
});

const seedUploadState = () => {
  facadeUploadState.clear();
  currentProject.buildings.forEach((building) => building.facades.forEach((facade) => {
    facadeUploadState.set(facade.id, normalizeUploads(facade.uploads));
  }));
};

const activeUploadTypes = (uploads) => uploads.model === "other" ? ["visible", "thermal"] : ["dji"];

const getManagedPhotos = (uploads) => activeUploadTypes(uploads).flatMap((type) =>
  (uploads[type] || []).map((photo) => ({ ...photo, bucket: type, typeLabel: PHOTO_TYPE_LABELS[type] }))
);

const ensureReviewState = () => {
  currentProject.review ||= {};
  currentProject.review.confirmedPhotoIds ||= [];
  return new Set(currentProject.review.confirmedPhotoIds);
};

const collectReviewPhotos = () => {
  const photos = [];
  currentProject.buildings.forEach((building) => {
    building.facades.forEach((facade) => {
      const uploads = normalizeUploads(facadeUploadState.get(facade.id) || facade.uploads);
      getManagedPhotos(uploads).forEach((photo) => {
        photos.push({
          id: `${facade.id}:${photo.id}`,
          name: `${building.name || "未命名建筑"} · ${facade.name || "未命名立面"} · ${photo.name}`,
          src: photo.src,
        });
      });
    });
  });

  if (photos.length) return photos;
  return REVIEW_SAMPLE_PHOTOS.map((photo) => ({
    ...photo,
    id: `${currentProject.id}:sample:${photo.id}`,
  }));
};

const uploadCount = (uploads) => getManagedPhotos(normalizeUploads(uploads)).length;

const updateUploadButton = (row) => {
  const uploads = normalizeUploads(facadeUploadState.get(row.dataset.facadeId));
  const count = uploadCount(uploads);
  const label = row.querySelector(".upload-photo-button span");
  label.textContent = count ? `已上传 ${count} 张` : "上传照片";
  row.querySelector(".upload-photo-button").classList.toggle("has-files", count > 0);
  row.querySelector(".photo-manage-button")?.classList.toggle("has-files", count > 0);
};

const renderFacade = (facade, facadeList) => {
  const fragment = facadeTemplate.content.cloneNode(true);
  const row = fragment.querySelector("[data-facade]");
  row.dataset.facadeId = facade.id;
  row.querySelector("[data-facade-name]").value = facade.name;
  facadeList.append(fragment);
  updateUploadButton(facadeList.lastElementChild);
};

const renderBuilding = (building) => {
  const fragment = buildingTemplate.content.cloneNode(true);
  const card = fragment.querySelector("[data-building]");
  card.dataset.buildingId = building.id;
  card.querySelector(".building-heading-copy strong").textContent = building.name || "未命名建筑";
  card.querySelector("[data-building-name]").value = building.name;
  card.querySelector("[data-building-floors]").value = building.floors;
  card.querySelector("[data-building-height]").value = building.height;
  const facadeList = card.querySelector("[data-facade-list]");
  building.facades.forEach((facade) => renderFacade(facade, facadeList));
  buildingList.append(fragment);
};

const updateStructureSummary = () => {
  const buildings = [...buildingList.querySelectorAll("[data-building]")];
  const facadeCount = buildingList.querySelectorAll("[data-facade]").length;
  structureSummary.textContent = `${buildings.length} 栋建筑 · ${facadeCount} 个检测立面`;
  buildings.forEach((building, index) => {
    const name = building.querySelector("[data-building-name]").value.trim() || "未命名建筑";
    building.querySelector(".building-number").textContent = `建筑 ${String(index + 1).padStart(2, "0")}`;
    building.querySelector(".building-heading-copy strong").textContent = name;
    building.querySelectorAll(".facade-index").forEach((item, facadeIndex) => {
      item.textContent = String(facadeIndex + 1).padStart(2, "0");
    });
  });
};

const renderBuildings = () => {
  buildingList.innerHTML = "";
  currentProject.buildings.forEach(renderBuilding);
  updateStructureSummary();
  renderIcons();
};

const modelTypeInputs = () => [...modelTypesControl.querySelectorAll("[data-model-type]")];

const selectedModelTypes = () => modelTypeInputs().filter((input) => input.checked).map((input) => input.value);

const updateModelSelectionState = () => {
  const selected = selectedModelTypes();
  selectedModelCount.textContent = selected.length;
  modelConfigPanel.classList.toggle("has-error", selected.length === 0);
  if (selected.length > 0) modelTypesError.textContent = "";
  modelTypeInputs().forEach((input) => {
    input.closest(".model-option")?.classList.toggle("is-selected", input.checked);
  });
};

const updateDetectionModeState = () => {
  [standardDetectionInput, highPrecisionInput].forEach((input) => {
    input.closest(".detection-mode-option")?.classList.toggle("is-selected", input.checked);
  });
};

const populateModelSettings = () => {
  const modelSettings = normalizeModelSettings(currentProject.modelSettings);
  modelTypeInputs().forEach((input) => {
    input.checked = modelSettings.types.includes(input.value);
  });
  standardDetectionInput.checked = !modelSettings.highPrecision;
  highPrecisionInput.checked = modelSettings.highPrecision;
  updateModelSelectionState();
  updateDetectionModeState();
};

const populateForm = () => {
  document.querySelector("#project-name").value = currentProject.name;
  projectLocation.value = currentProject.location;
  document.querySelector("#client-name").value = currentProject.client || "";
  document.querySelector("#contact-name").value = currentProject.contact || "";
  document.querySelector("#contact-phone").value = currentProject.phone || "";
  const division = currentProject.administrativeDivision;
  fillSelect(provinceSelect, Object.keys(REGION_DATA), division.province);
  updateCities(division.city, division.district);
  setCoordinates(currentProject.coordinates, "项目位置");
  populateModelSettings();
  seedUploadState();
  renderBuildings();
  document.title = `${currentProject.name} - 项目详情`;
  updateDetailActionState();
};

const setEditMode = (editing) => {
  isEditing = editing;
  document.body.classList.toggle("is-editing", editing);
  projectForm.querySelectorAll("input:not([type='file']):not([type='checkbox'])").forEach((input) => {
    if (input === longitudeInput || input === latitudeInput) return;
    input.readOnly = !editing;
  });
  projectForm.querySelectorAll("select, input[type='checkbox'], input[type='radio']").forEach((field) => { field.disabled = !editing; });
  locateButton.disabled = !editing;
  projectForm.querySelectorAll(".upload-photo-button").forEach((button) => {
    button.disabled = !editing;
  });
  projectForm.querySelectorAll(".photo-manage-button").forEach((button) => {
    button.disabled = false;
  });
  if (marker?.dragging) {
    if (editing) marker.dragging.enable(); else marker.dragging.disable();
  }
  renderIcons();
};

const findFacade = (facadeId) => {
  for (const building of currentProject.buildings) {
    const facade = building.facades.find((item) => item.id === facadeId);
    if (facade) return facade;
  }
  return undefined;
};

const collectProjectFromForm = () => ({
  ...currentProject,
  name: document.querySelector("#project-name").value.trim(),
  administrativeDivision: { province: provinceSelect.value, city: citySelect.value, district: districtSelect.value },
  location: projectLocation.value.trim(),
  client: document.querySelector("#client-name").value.trim(),
  contact: document.querySelector("#contact-name").value.trim(),
  phone: document.querySelector("#contact-phone").value.trim(),
  coordinates: { ...currentPosition },
  modelSettings: {
    types: selectedModelTypes(),
    highPrecision: highPrecisionInput.checked,
  },
  buildings: [...buildingList.querySelectorAll("[data-building]")].map((building) => ({
    id: building.dataset.buildingId,
    name: building.querySelector("[data-building-name]").value.trim(),
    floors: Number(building.querySelector("[data-building-floors]").value),
    height: Number(building.querySelector("[data-building-height]").value),
    facades: [...building.querySelectorAll("[data-facade]")].map((facade) => ({
      id: facade.dataset.facadeId,
      name: facade.querySelector("[data-facade-name]").value.trim(),
      uploads: deepClone(normalizeUploads(facadeUploadState.get(facade.dataset.facadeId))),
    })),
  })),
});

const setFieldError = (field, message) => {
  const wrapper = field.closest(".form-field");
  wrapper?.classList.add("has-error");
  const error = wrapper?.querySelector(".field-error");
  if (error) error.textContent = message;
};

const validateForm = () => {
  document.querySelectorAll(".has-error").forEach((field) => field.classList.remove("has-error"));
  let firstInvalid;
  const required = [
    [document.querySelector("#project-name"), "请填写项目名称"], [projectLocation, "请填写项目位置"],
    [document.querySelector("#client-name"), "请填写委托单位"], [document.querySelector("#contact-name"), "请填写联系人"],
    [document.querySelector("#contact-phone"), "请填写联系电话"],
  ];
  required.forEach(([field, message]) => {
    if (!field.value.trim()) { setFieldError(field, message); firstInvalid ||= field; }
  });
  if (selectedModelTypes().length === 0) {
    modelConfigPanel.classList.add("has-error");
    modelTypesError.textContent = "请至少选择一个检测模型";
    firstInvalid ||= modelTypesControl;
  }
  buildingList.querySelectorAll("[data-building]").forEach((building) => {
    const fields = [building.querySelector("[data-building-name]"), building.querySelector("[data-building-floors]"), building.querySelector("[data-building-height]")];
    fields.forEach((field, index) => {
      if ((index === 0 && !field.value.trim()) || (index > 0 && Number(field.value) <= 0)) {
        setFieldError(field, index === 0 ? "请填写建筑名称" : "请输入大于 0 的数值"); firstInvalid ||= field;
      }
    });
    building.querySelectorAll("[data-facade]").forEach((facade) => {
      const name = facade.querySelector("[data-facade-name]");
      if (!name.value.trim()) { name.closest("label").classList.add("has-error"); firstInvalid ||= name; }
    });
  });
  if (!firstInvalid) return true;
  firstInvalid.closest("[data-building]")?.classList.remove("is-collapsed");
  firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
  firstInvalid.focus({ preventScroll: true });
  showToast("还有必填信息未完成，请检查标红字段");
  return false;
};

startAIDetectionButton.addEventListener("click", () => {
  if (isReportReady() || isReportPendingPush()) {
    openReportDialog();
    return;
  }
  if (isDetectionReviewing()) {
    openReviewDialog();
    return;
  }
  if (!validateForm()) return;
  currentProject = collectProjectFromForm();
  currentProject.status = "AI检测中";
  if (persistProject()) {
    setEditMode(false);
    updateDetailActionState();
    showToast("AI检测已开始");
  }
});

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm()) return;
  currentProject = collectProjectFromForm();
  persistProject();
  setEditMode(canEditProject());
  updateDetailActionState();
  showToast("项目修改已保存");
});

addBuildingButton.addEventListener("click", () => {
  const building = createBuilding(`building-${++buildingSequence}`, "", 1, 1);
  building.facades.forEach((facade) => facadeUploadState.set(facade.id, deepClone(facade.uploads)));
  renderBuilding(building);
  updateStructureSummary();
  setEditMode(true);
  renderIcons();
  buildingList.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
});

buildingList.addEventListener("input", (event) => {
  event.target.closest(".form-field, label")?.classList.remove("has-error");
  updateStructureSummary();
});

const setUploadSummary = (type) => {
  const files = pendingUploads[type] || [];
  document.querySelector(`[data-upload-summary="${type}"]`).textContent = files.length ? `已选择 ${files.length} 张` : "尚未选择文件";
};

const toggleUploadMode = () => {
  const other = droneModel.value === "other";
  djiUploadSection.hidden = other;
  otherUploadSection.hidden = !other;
  pendingUploads.model = droneModel.value;
};

const openUpload = (row) => {
  activeFacadeId = row.dataset.facadeId;
  const name = row.querySelector("[data-facade-name]").value || "未命名立面";
  document.querySelector("#upload-facade-name").textContent = `${name} · 上传照片`;
  pendingUploads = deepClone(normalizeUploads(facadeUploadState.get(activeFacadeId)));
  droneModel.value = pendingUploads.model || "dji";
  ["dji", "visible", "thermal"].forEach(setUploadSummary);
  uploadForm.querySelectorAll("input[type='file']").forEach((input) => { input.value = ""; });
  toggleUploadMode();
  uploadDialog.showModal();
};

const syncFacadeUploads = (facadeId, uploads, shouldPersist = true) => {
  const normalized = normalizeUploads(uploads);
  facadeUploadState.set(facadeId, normalized);
  const facade = findFacade(facadeId);
  if (facade) facade.uploads = deepClone(normalized);
  const persisted = shouldPersist ? persistProject() : true;
  const row = buildingList.querySelector(`[data-facade-id="${CSS.escape(facadeId)}"]`);
  if (row) updateUploadButton(row);
  return persisted;
};

const setPhotoPreview = (photo) => {
  deleteSelectedPhotoButton.disabled = !photo || !isEditing;

  if (photo?.src) {
    photoPreviewImage.src = photo.src;
    photoPreviewImage.alt = photo.name;
    photoPreviewImage.hidden = false;
    photoPreviewEmpty.hidden = true;
    return;
  }

  photoPreviewImage.hidden = true;
  photoPreviewImage.removeAttribute("src");
  photoPreviewImage.alt = "";
  photoPreviewEmpty.hidden = false;
  photoPreviewEmpty.querySelector("span").textContent = photo ? "该记录只有文件名，重新上传后可预览" : "暂无可预览图片";
};

const renderPhotoManager = () => {
  const uploads = normalizeUploads(facadeUploadState.get(activePhotoFacadeId));
  const photos = getManagedPhotos(uploads);
  photoFileList.innerHTML = "";

  if (!photos.length) {
    selectedPhotoId = undefined;
    const empty = document.createElement("div");
    empty.className = "photo-file-empty";
    empty.textContent = "暂无照片文件";
    photoFileList.append(empty);
    setPhotoPreview();
    renderIcons();
    return;
  }

  if (!photos.some((photo) => photo.id === selectedPhotoId)) selectedPhotoId = photos[0].id;
  photos.forEach((photo) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-file-item";
    button.dataset.photoId = photo.id;
    button.setAttribute("aria-pressed", String(photo.id === selectedPhotoId));

    const name = document.createElement("span");
    name.textContent = photo.name;

    button.append(name);
    photoFileList.append(button);
  });

  setPhotoPreview(photos.find((photo) => photo.id === selectedPhotoId));
  renderIcons();
};

const openPhotoManager = (row) => {
  activePhotoFacadeId = row.dataset.facadeId;
  selectedPhotoId = undefined;
  const name = row.querySelector("[data-facade-name]").value || "未命名立面";
  document.querySelector("#photo-manage-facade-name").textContent = `${name} · 照片管理`;
  renderPhotoManager();
  photoManageDialog.showModal();
};

const setReviewPreview = (photo) => {
  if (photo?.src) {
    reviewPreviewImage.src = photo.src;
    reviewPreviewImage.alt = photo.name;
    reviewPreviewImage.hidden = false;
    reviewPreviewEmpty.hidden = true;
    return;
  }

  reviewPreviewImage.hidden = true;
  reviewPreviewImage.removeAttribute("src");
  reviewPreviewImage.alt = "";
  reviewPreviewEmpty.hidden = false;
  reviewPreviewEmpty.querySelector("span").textContent = photo ? "该记录只有文件名，重新上传后可预览" : "暂无可复核图片";
};

const renderReviewDialog = () => {
  const confirmedIds = ensureReviewState();
  const allConfirmed = reviewPhotos.length > 0 && reviewPhotos.every((photo) => confirmedIds.has(photo.id));
  reviewPhotoList.innerHTML = "";

  if (!reviewPhotos.length) {
    selectedReviewPhotoId = undefined;
    const empty = document.createElement("div");
    empty.className = "photo-file-empty";
    empty.textContent = "暂无待复核照片";
    reviewPhotoList.append(empty);
    setReviewPreview();
    reviewEditButton.hidden = true;
    reviewConfirmButton.hidden = true;
    reviewResetButton.hidden = true;
    generateReportButton.hidden = true;
    renderIcons();
    return;
  }

  if (!reviewPhotos.some((photo) => photo.id === selectedReviewPhotoId)) {
    selectedReviewPhotoId = reviewPhotos.find((photo) => !confirmedIds.has(photo.id))?.id || reviewPhotos[0].id;
  }

  reviewPhotos.forEach((photo) => {
    const confirmed = confirmedIds.has(photo.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photo-file-item review-photo-item${confirmed ? " is-confirmed" : ""}`;
    button.dataset.reviewPhotoId = photo.id;
    button.setAttribute("aria-pressed", String(photo.id === selectedReviewPhotoId));

    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", confirmed ? "check-circle-2" : "circle");
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.textContent = photo.name;

    button.append(icon, name);
    reviewPhotoList.append(button);
  });

  const selectedPhoto = reviewPhotos.find((photo) => photo.id === selectedReviewPhotoId);
  setReviewPreview(selectedPhoto);
  reviewEditButton.hidden = allConfirmed;
  reviewConfirmButton.hidden = allConfirmed;
  reviewConfirmButton.disabled = Boolean(selectedPhoto && confirmedIds.has(selectedPhoto.id) && !allConfirmed);
  reviewResetButton.hidden = !allConfirmed;
  generateReportButton.hidden = !allConfirmed;
  renderIcons();
};

const openReviewDialog = () => {
  reviewPhotos = collectReviewPhotos();
  const confirmedIds = ensureReviewState();
  selectedReviewPhotoId = reviewPhotos.find((photo) => !confirmedIds.has(photo.id))?.id || reviewPhotos[0]?.id;
  renderReviewDialog();
  reviewDialog.showModal();
};

const renderReportPreview = () => {
  const pendingPush = isReportPendingPush();
  const reportTime = currentProject.review?.reportGeneratedAt || currentProject.updatedAt || currentProject.createdAt;
  const frame = document.createElement("iframe");
  frame.className = "report-pdf-frame";
  frame.src = REPORT_PDF_URL;
  frame.title = "示例报告PDF";

  reportTitle.textContent = pendingPush ? "报告预览与推送" : "示例报告PDF";
  reportSubtitle.textContent = `${currentProject.name} · 报告生成时间 ${formatDateTime(reportTime)}`;
  exportReportButton.hidden = pendingPush;
  pushReportButton.hidden = !pendingPush;
  reportPreview.replaceChildren(frame);
  renderIcons();
};

const openReportDialog = () => {
  renderReportPreview();
  reportDialog.showModal();
};

const confirmSelectedReviewPhoto = () => {
  if (!selectedReviewPhotoId) return;
  const confirmedIds = ensureReviewState();
  confirmedIds.add(selectedReviewPhotoId);
  currentProject.review.confirmedPhotoIds = [...confirmedIds];
  const currentIndex = reviewPhotos.findIndex((photo) => photo.id === selectedReviewPhotoId);
  const nextPhoto = reviewPhotos.slice(currentIndex + 1).find((photo) => !confirmedIds.has(photo.id)) ||
    reviewPhotos.find((photo) => !confirmedIds.has(photo.id));
  selectedReviewPhotoId = nextPhoto?.id || selectedReviewPhotoId;
  if (!persistProject()) return;
  renderReviewDialog();
  showToast(nextPhoto ? "已确认，已切换到下一张" : "全部照片已确认");
};

buildingList.addEventListener("click", (event) => {
  const building = event.target.closest("[data-building]");
  const row = event.target.closest("[data-facade]");
  if (event.target.closest(".upload-photo-button") && row) { openUpload(row); return; }
  if (event.target.closest(".photo-manage-button") && row) { openPhotoManager(row); return; }
  if (!building) return;
  if (event.target.closest(".building-toggle")) {
    const collapsed = building.classList.toggle("is-collapsed");
    building.querySelector(".building-toggle").setAttribute("aria-expanded", String(!collapsed));
    return;
  }
  if (!isEditing) return;
  if (event.target.closest(".remove-building-button")) {
    if (buildingList.querySelectorAll("[data-building]").length === 1) { showToast("项目至少需要保留一栋建筑"); return; }
    building.remove(); updateStructureSummary(); return;
  }
  if (event.target.closest(".add-facade-button")) {
    const facade = createFacade(`facade-${++facadeSequence}`, "");
    facadeUploadState.set(facade.id, deepClone(facade.uploads));
    renderFacade(facade, building.querySelector("[data-facade-list]"));
    updateStructureSummary(); setEditMode(true); renderIcons(); return;
  }
  const removeFacadeButton = event.target.closest(".remove-facade-button");
  if (removeFacadeButton && row) {
    if (building.querySelectorAll("[data-facade]").length === 1) { showToast("每栋建筑至少需要保留一个检测立面"); return; }
    facadeUploadState.delete(row.dataset.facadeId);
    row.remove(); updateStructureSummary();
  }
});

droneModel.addEventListener("change", toggleUploadMode);
modelTypesControl.addEventListener("change", updateModelSelectionState);
[standardDetectionInput, highPrecisionInput].forEach((input) => input.addEventListener("change", updateDetectionModeState));

photoFileList.addEventListener("click", (event) => {
  const item = event.target.closest(".photo-file-item");
  if (!item) return;
  selectedPhotoId = item.dataset.photoId;
  renderPhotoManager();
});

reviewPhotoList.addEventListener("click", (event) => {
  const item = event.target.closest(".review-photo-item");
  if (!item) return;
  selectedReviewPhotoId = item.dataset.reviewPhotoId;
  renderReviewDialog();
});

deleteSelectedPhotoButton.addEventListener("click", () => {
  if (!activePhotoFacadeId || !selectedPhotoId) return;
  const uploads = normalizeUploads(facadeUploadState.get(activePhotoFacadeId));
  let deleted = false;
  PHOTO_TYPES.forEach((type) => {
    uploads[type] = uploads[type].filter((photo) => {
      if (photo.id === selectedPhotoId) {
        deleted = true;
        return false;
      }
      return true;
    });
  });
  if (!deleted) return;
  const remaining = getManagedPhotos(uploads);
  selectedPhotoId = remaining[0]?.id;
  const persisted = syncFacadeUploads(activePhotoFacadeId, uploads);
  renderPhotoManager();
  if (persisted) showToast("照片已删除");
});

reviewEditButton.addEventListener("click", () => {
  if (!selectedReviewPhotoId) return;
  showToast("已进入复核修改状态");
});

reviewConfirmButton.addEventListener("click", confirmSelectedReviewPhoto);

reviewResetButton.addEventListener("click", () => {
  currentProject.review ||= {};
  currentProject.review.confirmedPhotoIds = [];
  selectedReviewPhotoId = reviewPhotos[0]?.id;
  if (!persistProject()) return;
  renderReviewDialog();
  showToast("已取消所有照片确认状态");
});

generateReportButton.addEventListener("click", () => {
  currentProject.review ||= {};
  currentProject.review.reportGeneratedAt = new Date().toISOString();
  delete currentProject.review.reportPushedAt;
  if (!persistProject()) return;
  updateDetailActionState();
  reviewDialog.close();
  showToast("审核完成，报告已生成，待推送");
});

pushReportButton.addEventListener("click", () => {
  currentProject.status = "已出报告";
  currentProject.review ||= {};
  currentProject.review.reportGeneratedAt ||= new Date().toISOString();
  currentProject.review.reportPushedAt = new Date().toISOString();
  if (!persistProject()) return;
  updateDetailActionState();
  reportDialog.close();
  showToast("报告已推送");
});

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener("load", () => resolve(reader.result));
  reader.addEventListener("error", () => reject(reader.error));
  reader.readAsDataURL(file);
});

const createPreviewDataUrl = (dataUrl, mime) => new Promise((resolve) => {
  if (!mime.startsWith("image/") || mime === "image/gif") {
    resolve(dataUrl);
    return;
  }

  const image = new Image();
  image.addEventListener("load", () => {
    const maxEdge = 1400;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL("image/jpeg", 0.82));
  });
  image.addEventListener("error", () => resolve(dataUrl));
  image.src = dataUrl;
});

const createPhotoRecordFromFile = async (file, type, index) => ({
  id: createPhotoId(type, index),
  name: file.name,
  src: await createPreviewDataUrl(await readFileAsDataUrl(file), file.type),
  mime: file.type,
  size: file.size,
});

const bindFileInput = (id, type) => {
  document.querySelector(id).addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) {
      pendingUploads[type] = [];
      setUploadSummary(type);
      return;
    }

    document.querySelector(`[data-upload-summary="${type}"]`).textContent = "正在读取图片...";
    try {
      pendingUploads[type] = await Promise.all(files.map((file, index) => createPhotoRecordFromFile(file, type, index)));
      setUploadSummary(type);
    } catch (error) {
      pendingUploads[type] = [];
      setUploadSummary(type);
      showToast("图片读取失败，请重新选择照片");
    }
  });
};

bindFileInput("#dji-photo-input", "dji");
bindFileInput("#visible-photo-input", "visible");
bindFileInput("#thermal-photo-input", "thermal");

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextUploads = normalizeUploads(pendingUploads);
  if (nextUploads.model === "dji" && nextUploads.dji.length === 0) { showToast("请先选择要上传的照片"); return; }
  if (nextUploads.model === "other" && (nextUploads.visible.length === 0 || nextUploads.thermal.length === 0)) {
    showToast("其他型号需要分别上传可见光和热成像图片"); return;
  }
  const persisted = syncFacadeUploads(activeFacadeId, nextUploads);
  if (!persisted) return;
  uploadDialog.close();
  showToast("照片记录已保存");
});

document.querySelectorAll("[data-close-upload]").forEach((button) => button.addEventListener("click", () => uploadDialog.close()));
document.querySelectorAll("[data-close-photo-manage]").forEach((button) => button.addEventListener("click", () => photoManageDialog.close()));
document.querySelectorAll("[data-close-review]").forEach((button) => button.addEventListener("click", () => reviewDialog.close()));
document.querySelectorAll("[data-close-report]").forEach((button) => button.addEventListener("click", () => reportDialog.close()));
[uploadDialog, photoManageDialog, reviewDialog, reportDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

applyNavigationContext();
currentProject = loadProject();
if (!currentProject) {
  workspace.hidden = true;
  notFound.hidden = false;
  renderIcons();
} else {
  populateForm();
  initializeMap(currentProject.coordinates);
  setEditMode(canEditProject());
  updateDetailActionState();
  if (urlParams.get("created") === "1") {
    showToast("项目已创建，可继续补充信息或开始AI检测");
    const cleanParams = new URLSearchParams({ id: currentProject.id });
    if (isReviewWorkbenchEntry) cleanParams.set("review", "1");
    history.replaceState({}, "", `project-detail.html?${cleanParams.toString()}`);
  }
  if (shouldOpenReview && isDetectionReviewing()) {
    window.requestAnimationFrame(openReviewDialog);
  }
}
