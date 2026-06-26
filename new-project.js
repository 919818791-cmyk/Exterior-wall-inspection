const STORAGE_KEY = "building-exterior-projects";
const DEFAULT_POSITION = { lat: 22.5431, lng: 114.0579 };
const DEFAULT_FACADES = [
  { name: "东立面" },
  { name: "南立面" },
  { name: "西立面" },
  { name: "北立面" },
];

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

const projectForm = document.querySelector("#new-project-form");
const buildingList = document.querySelector("#building-list");
const buildingTemplate = document.querySelector("#building-template");
const facadeTemplate = document.querySelector("#facade-template");
const addBuildingButton = document.querySelector("#add-building-button");
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

let map;
let marker;
let currentPosition = { ...DEFAULT_POSITION };
let buildingSequence = 0;
let facadeSequence = 0;
let toastTimer;

const showToast = (message) => {
  clearTimeout(toastTimer);
  projectToast.textContent = message;
  projectToast.classList.add("is-visible");
  toastTimer = setTimeout(() => projectToast.classList.remove("is-visible"), 3200);
};

const renderIcons = () => {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2.1 } });
  }
};

const fillSelect = (select, values, selectedValue) => {
  select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
  if (selectedValue && values.includes(selectedValue)) select.value = selectedValue;
};

const updateCities = (preferredCity, preferredDistrict) => {
  const cities = Object.keys(REGION_DATA[provinceSelect.value]);
  fillSelect(citySelect, cities, preferredCity);
  updateDistricts(preferredDistrict);
};

const updateDistricts = (preferredDistrict) => {
  const districts = REGION_DATA[provinceSelect.value][citySelect.value];
  fillSelect(districtSelect, districts, preferredDistrict);
};

fillSelect(provinceSelect, Object.keys(REGION_DATA), "广东省");
updateCities("深圳市", "南山区");
provinceSelect.addEventListener("change", () => updateCities());
citySelect.addEventListener("change", () => updateDistricts());

const setCoordinates = ({ lat, lng }, statusText = "已从地图提取经纬度") => {
  currentPosition = { lat: Number(lat), lng: Number(lng) };
  latitudeInput.value = currentPosition.lat.toFixed(6);
  longitudeInput.value = currentPosition.lng.toFixed(6);
  mapStatus.textContent = statusText;
};

const initializeMap = () => {
  setCoordinates(DEFAULT_POSITION, "拖动标记可微调项目位置");
  if (!window.L) {
    document.querySelector("#project-map").classList.add("map-unavailable");
    mapStatus.textContent = "在线地图暂时无法加载，请稍后重试";
    return;
  }

  map = L.map("project-map", { zoomControl: true }).setView([DEFAULT_POSITION.lat, DEFAULT_POSITION.lng], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  marker = L.marker([DEFAULT_POSITION.lat, DEFAULT_POSITION.lng], { draggable: true }).addTo(map);
  marker.bindTooltip("拖动调整项目位置", { direction: "top", offset: [0, -12] }).openTooltip();
  marker.on("dragend", () => setCoordinates(marker.getLatLng(), "位置已手动调整"));
  map.on("click", (event) => {
    marker.setLatLng(event.latlng);
    setCoordinates(event.latlng, "位置已手动调整");
  });
};

const regionText = () => `${provinceSelect.value}${citySelect.value}${districtSelect.value}`;

const locateAddress = async () => {
  const address = projectLocation.value.trim();
  if (!address) {
    projectLocation.focus();
    showToast("请先填写项目位置");
    return;
  }

  locateButton.disabled = true;
  locateButton.classList.add("is-loading");
  locateButton.querySelector("span").textContent = "定位中";
  mapStatus.textContent = "正在根据项目位置定位…";
  const query = `${address}, ${districtSelect.value}, ${citySelect.value}, ${provinceSelect.value}, 中国`;

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cn&q=${encodeURIComponent(query)}`, {
      headers: { "Accept-Language": "zh-CN" },
    });
    if (!response.ok) throw new Error("geocoding failed");
    const [result] = await response.json();
    if (!result) throw new Error("no result");
    const position = { lat: Number(result.lat), lng: Number(result.lon) };
    setCoordinates(position, "定位成功，可拖动标记微调");
    if (map && marker) {
      marker.setLatLng(position);
      map.flyTo(position, 17, { duration: 0.8 });
    }
  } catch (error) {
    mapStatus.textContent = "未找到精确位置，请尝试补充街道或门牌号";
    showToast("暂未找到该位置，请完善地址后重试");
  } finally {
    locateButton.disabled = false;
    locateButton.classList.remove("is-loading");
    locateButton.querySelector("span").textContent = "定位";
  }
};

locateButton.addEventListener("click", locateAddress);
projectLocation.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    locateAddress();
  }
});
resetMapButton.addEventListener("click", () => {
  if (map && marker) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
});

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

const addFacade = (building, facade = { name: "" }) => {
  const fragment = facadeTemplate.content.cloneNode(true);
  const row = fragment.querySelector("[data-facade]");
  row.dataset.facadeId = `facade-${++facadeSequence}`;
  row.querySelector("[data-facade-name]").value = facade.name;
  building.querySelector("[data-facade-list]").append(fragment);
  updateStructureSummary();
  renderIcons();
};

const addBuilding = ({ scroll = true } = {}) => {
  const fragment = buildingTemplate.content.cloneNode(true);
  const building = fragment.querySelector("[data-building]");
  building.dataset.buildingId = `building-${++buildingSequence}`;
  buildingList.append(fragment);
  DEFAULT_FACADES.forEach((facade) => addFacade(building, facade));
  updateStructureSummary();
  renderIcons();
  if (scroll) building.scrollIntoView({ behavior: "smooth", block: "center" });
};

addBuildingButton.addEventListener("click", () => addBuilding());

buildingList.addEventListener("input", (event) => {
  const field = event.target.closest("input");
  if (field) {
    field.closest(".form-field, label")?.classList.remove("has-error");
    updateStructureSummary();
  }
});

buildingList.addEventListener("click", (event) => {
  const building = event.target.closest("[data-building]");
  if (!building) return;

  if (event.target.closest(".building-toggle")) {
    const collapsed = building.classList.toggle("is-collapsed");
    building.querySelector(".building-toggle").setAttribute("aria-expanded", String(!collapsed));
    return;
  }

  if (event.target.closest(".remove-building-button")) {
    if (buildingList.querySelectorAll("[data-building]").length === 1) {
      showToast("项目至少需要保留一栋建筑");
      return;
    }
    building.remove();
    updateStructureSummary();
    return;
  }

  if (event.target.closest(".add-facade-button")) {
    addFacade(building, { name: "" });
    const lastFacadeName = building.querySelector("[data-facade-list] [data-facade]:last-child [data-facade-name]");
    lastFacadeName?.focus();
    return;
  }

  const removeFacadeButton = event.target.closest(".remove-facade-button");
  if (removeFacadeButton) {
    const facades = building.querySelectorAll("[data-facade]");
    if (facades.length === 1) {
      showToast("每栋建筑至少需要保留一个检测立面");
      return;
    }
    removeFacadeButton.closest("[data-facade]").remove();
    updateStructureSummary();
  }
});

const setFieldError = (field, message) => {
  const wrapper = field.closest(".form-field");
  wrapper?.classList.add("has-error");
  const error = wrapper?.querySelector(".field-error");
  if (error) error.textContent = message;
};

const clearErrors = () => {
  document.querySelectorAll(".has-error").forEach((field) => field.classList.remove("has-error"));
  document.querySelectorAll(".field-error").forEach((error) => { error.textContent = ""; });
};

const validateForm = () => {
  clearErrors();
  let firstInvalid;
  const requiredFields = [
    [document.querySelector("#project-name"), "请填写项目名称"],
    [projectLocation, "请填写项目位置"],
    [document.querySelector("#client-name"), "请填写委托单位"],
    [document.querySelector("#contact-name"), "请填写联系人"],
    [document.querySelector("#contact-phone"), "请填写联系电话"],
  ];

  requiredFields.forEach(([field, message]) => {
    if (!field.value.trim()) {
      setFieldError(field, message);
      firstInvalid ||= field;
    }
  });

  const phone = document.querySelector("#contact-phone");
  if (phone.value.trim() && !/^[0-9+()\-\s]{6,20}$/.test(phone.value.trim())) {
    setFieldError(phone, "请输入有效的联系电话");
    firstInvalid ||= phone;
  }

  buildingList.querySelectorAll("[data-building]").forEach((building) => {
    const fields = [
      [building.querySelector("[data-building-name]"), "请填写建筑名称"],
      [building.querySelector("[data-building-floors]"), "请输入大于 0 的层数"],
      [building.querySelector("[data-building-height]"), "请输入大于 0 的高度"],
    ];
    fields.forEach(([field, message], index) => {
      const invalid = index === 0 ? !field.value.trim() : Number(field.value) <= 0;
      if (invalid) {
        setFieldError(field, message);
        firstInvalid ||= field;
      }
    });

    building.querySelectorAll("[data-facade]").forEach((facade) => {
      const name = facade.querySelector("[data-facade-name]");
      if (!name.value.trim()) {
        name.closest("label").classList.add("has-error");
        firstInvalid ||= name;
      }
    });
  });

  if (firstInvalid) {
    firstInvalid.closest("[data-building]")?.classList.remove("is-collapsed");
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    firstInvalid.focus({ preventScroll: true });
    showToast("还有必填信息未完成，请检查标红字段");
    return false;
  }
  return true;
};

const collectProject = () => ({
  id: `project-${Date.now()}`,
  name: document.querySelector("#project-name").value.trim(),
  administrativeDivision: {
    province: provinceSelect.value,
    city: citySelect.value,
    district: districtSelect.value,
  },
  location: projectLocation.value.trim(),
  client: document.querySelector("#client-name").value.trim(),
  contact: document.querySelector("#contact-name").value.trim(),
  phone: document.querySelector("#contact-phone").value.trim(),
  coordinates: { ...currentPosition },
  buildings: [...buildingList.querySelectorAll("[data-building]")].map((building) => ({
    id: building.dataset.buildingId,
    name: building.querySelector("[data-building-name]").value.trim(),
    floors: Number(building.querySelector("[data-building-floors]").value),
    height: Number(building.querySelector("[data-building-height]").value),
    facades: [...building.querySelectorAll("[data-facade]")].map((facade) => ({
      id: facade.dataset.facadeId,
      name: facade.querySelector("[data-facade-name]").value.trim(),
    })),
  })),
  status: "待检测",
  createdAt: new Date().toISOString(),
});

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm()) return;
  const project = collectProject();
  let projects = [];
  try {
    projects = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(projects)) projects = [];
  } catch (error) {
    projects = [];
  }
  projects.unshift(project);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  window.location.href = `project-detail.html?id=${encodeURIComponent(project.id)}&created=1`;
});

initializeMap();
addBuilding({ scroll: false });
