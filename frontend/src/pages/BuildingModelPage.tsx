import {
  Images,
  RotateCcw,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LineSegments,
  MathUtils,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  buildingModelQueryKey,
  buildingModelQueryOptions,
  buildingModelImagesQueryKey,
  buildingModelImagesQueryOptions,
  deleteBuildingModel,
  projectQueryOptions,
  uploadBuildingModel,
  uploadBuildingModelImages
} from "@/api/projects";
import { WorkspaceTitleBar } from "@/components/WorkspaceTitleBar";
import {
  EARTH_RADIUS_METERS,
  type GeographicModelOrigin,
  parseMetashapeProjectionPackage
} from "@/utils/buildingModelTags";
import type {
  BuildingModelImageKind,
  BuildingModelImageOrientation,
  BuildingModelImageUpload
} from "@/types/projects";

const MAX_BUILDING_MODEL_BYTES = 1024 * 1024 * 1024;
const EXAMPLE_BUILDING_MODEL_URL = "/models/tower_residential__modern_apartment_building_metalrough.glb";
const MODEL_UP = new Vector3(0, 1, 0);
const ELEVATION_PREVIEW_WIDTH = 2048;
const ELEVATION_PREVIEW_HEIGHT = 1536;

const ELEVATION_VIEWS = [
  { id: "east", label: "东立面" },
  { id: "west", label: "西立面" },
  { id: "south", label: "南立面" },
  { id: "north", label: "北立面" }
] as const;

type ElevationId = (typeof ELEVATION_VIEWS)[number]["id"];
type ElevationImages = Partial<Record<ElevationId, string>>;
type ElevationDirections = Record<ElevationId, Vector3>;
type ModelImageSlotKey = `${BuildingModelImageOrientation}:${BuildingModelImageKind}`;
type ModelImageUploadRequest = {
  uploads: BuildingModelImageUpload[];
  closeOnSuccess: boolean;
};

const MODEL_IMAGE_UPLOAD_SLOTS = [
  {
    key: "overview:model" as ModelImageSlotKey,
    orientation: "overview" as const,
    imageKind: "model" as const,
    label: "模型立体视角图"
  },
  ...ELEVATION_VIEWS.flatMap((view) => ([
    {
      key: `${view.id}:elevation` as ModelImageSlotKey,
      orientation: view.id,
      imageKind: "elevation" as const,
      label: `${view.label}图`
    },
    {
      key: `${view.id}:annotated` as ModelImageSlotKey,
      orientation: view.id,
      imageKind: "annotated" as const,
      label: `${view.label}含损伤标注图`
    }
  ]))
];

function getElevationDirections(model: Object3D): ElevationDirections {
  model.updateWorldMatrix(true, true);

  let vertexCount = 0;
  model.traverse((object) => {
    if (object instanceof Mesh) {
      vertexCount += object.geometry.getAttribute("position")?.count ?? 0;
    }
  });

  if (vertexCount < 3) {
    return {
      east: new Vector3(1, 0, 0),
      west: new Vector3(-1, 0, 0),
      south: new Vector3(0, 0, 1),
      north: new Vector3(0, 0, -1)
    };
  }

  const stride = Math.max(1, Math.floor(vertexCount / 50_000));
  const sample = new Vector3();
  let count = 0;
  let meanX = 0;
  let meanZ = 0;
  let xx = 0;
  let xz = 0;
  let zz = 0;

  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;

    for (let index = 0; index < position.count; index += stride) {
      sample.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      count += 1;
      const deltaX = sample.x - meanX;
      const deltaZ = sample.z - meanZ;
      meanX += deltaX / count;
      meanZ += deltaZ / count;
      xx += deltaX * (sample.x - meanX);
      xz += deltaX * (sample.z - meanZ);
      zz += deltaZ * (sample.z - meanZ);
    }
  });

  const covarianceSpan = Math.hypot(xx - zz, 2 * xz);
  const eigenvalue = (xx + zz + covarianceSpan) / 2;
  const east = Math.abs(xz) > Number.EPSILON
    ? new Vector3(eigenvalue - zz, 0, xz).normalize()
    : xx >= zz
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
  if (east.x < 0 || (Math.abs(east.x) <= Number.EPSILON && east.z < 0)) east.negate();

  const south = new Vector3(-east.z, 0, east.x);
  if (south.z < 0 || (Math.abs(south.z) <= Number.EPSILON && south.x < 0)) south.negate();

  return {
    east,
    west: east.clone().negate(),
    south,
    north: south.clone().negate()
  };
}

function renderElevationImages(
  renderer: WebGLRenderer,
  scene: Scene,
  grid: GridHelper,
  model: Object3D,
  maxDimension: number
): ElevationImages {
  const originalBackground = scene.background;
  const originalGridVisibility = grid.visible;
  const originalRenderTarget = renderer.getRenderTarget();
  const originalAutoClear = renderer.autoClear;
  const originalClearColor = renderer.getClearColor(new Color());
  const originalClearAlpha = renderer.getClearAlpha();
  const aspect = ELEVATION_PREVIEW_WIDTH / ELEVATION_PREVIEW_HEIGHT;
  const pixels = new Uint8Array(
    ELEVATION_PREVIEW_WIDTH * ELEVATION_PREVIEW_HEIGHT * 4
  );
  const canvas = document.createElement("canvas");
  canvas.width = ELEVATION_PREVIEW_WIDTH;
  canvas.height = ELEVATION_PREVIEW_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    return {};
  }

  const images: ElevationImages = {};
  const viewBounds = new Box3().setFromObject(model, true);
  const viewSize = viewBounds.getSize(new Vector3());
  const center = viewBounds.getCenter(new Vector3());
  const directions = getElevationDirections(model);
  grid.visible = false;
  scene.background = new Color(0xf3f5f7);
  renderer.autoClear = false;
  renderer.setClearColor(0xf3f5f7, 1);

  try {
    ELEVATION_VIEWS.forEach((view) => {
      const direction = directions[view.id];
      const screenRight = MODEL_UP.clone().cross(direction).normalize();
      const horizontalSize = Math.abs(screenRight.x) * viewSize.x
        + Math.abs(screenRight.z) * viewSize.z;
      const halfHeight = Math.max(viewSize.y / 2, horizontalSize / (2 * aspect)) * 1.08;
      const elevationCamera = new OrthographicCamera(
        -halfHeight * aspect,
        halfHeight * aspect,
        halfHeight,
        -halfHeight,
        Math.max(maxDimension / 10_000, 0.01),
        maxDimension * 8
      );
      elevationCamera.position.copy(center).addScaledVector(direction, maxDimension * 3);
      elevationCamera.up.copy(MODEL_UP);
      elevationCamera.lookAt(center);
      elevationCamera.updateProjectionMatrix();
      elevationCamera.updateMatrixWorld(true);

      // A dedicated color/depth target keeps every elevation render isolated.
      const renderTarget = new WebGLRenderTarget(
        ELEVATION_PREVIEW_WIDTH,
        ELEVATION_PREVIEW_HEIGHT
      );
      renderTarget.texture.colorSpace = SRGBColorSpace;
      try {
        renderer.setRenderTarget(renderTarget);
        renderer.clear(true, true, true);
        renderer.render(scene, elevationCamera);
        renderer.readRenderTargetPixels(
          renderTarget,
          0,
          0,
          ELEVATION_PREVIEW_WIDTH,
          ELEVATION_PREVIEW_HEIGHT,
          pixels
        );

        const imageData = context.createImageData(
          ELEVATION_PREVIEW_WIDTH,
          ELEVATION_PREVIEW_HEIGHT
        );
        const rowLength = ELEVATION_PREVIEW_WIDTH * 4;
        for (let sourceY = 0; sourceY < ELEVATION_PREVIEW_HEIGHT; sourceY += 1) {
          const sourceStart = sourceY * rowLength;
          const targetStart = (ELEVATION_PREVIEW_HEIGHT - sourceY - 1) * rowLength;
          imageData.data.set(
            pixels.subarray(sourceStart, sourceStart + rowLength),
            targetStart
          );
        }
        context.putImageData(imageData, 0, 0);
        images[view.id] = canvas.toDataURL("image/jpeg", 0.95);
      } finally {
        renderTarget.dispose();
      }
    });
  } finally {
    renderer.setRenderTarget(originalRenderTarget);
    renderer.autoClear = originalAutoClear;
    renderer.setClearColor(originalClearColor, originalClearAlpha);
    scene.background = originalBackground;
    grid.visible = originalGridVisibility;
    model.updateWorldMatrix(true, true);
  }

  return images;
}

async function elevationImagesToUploads(
  images: ElevationImages
): Promise<BuildingModelImageUpload[]> {
  return Promise.all(ELEVATION_VIEWS.map(async (view) => {
    const imageUrl = images[view.id];
    if (!imageUrl) throw new Error(`${view.label}视角图生成失败。`);
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return {
      orientation: view.id,
      imageKind: "elevation" as const,
      file: new File([blob], `${view.id}-elevation.jpg`, { type: "image/jpeg" })
    };
  }));
}

const METASHAPE_GENERATOR_PATTERN = /^Agisoft Metashape\b/i;

function detectGeographicModelOrigin(bounds: Box3): GeographicModelOrigin | null {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const horizontalAngularSpan = Math.max(size.x, size.y);
  const isLongitudeLatitudeRange = (
    bounds.min.x >= -180
    && bounds.max.x <= 180
    && bounds.min.y >= -90
    && bounds.max.y <= 90
  );
  const hasGeographicOffset = Math.abs(center.x) > 10 || Math.abs(center.y) > 10;
  const hasSmallAngularSpan = horizontalAngularSpan > 0 && horizontalAngularSpan <= 1;
  const hasMixedAngularAndLinearUnits = size.z > horizontalAngularSpan * 1_000;

  if (
    !isLongitudeLatitudeRange
    || !hasGeographicOffset
    || !hasSmallAngularSpan
    || !hasMixedAngularAndLinearUnits
  ) {
    return null;
  }

  return {
    elevation: bounds.min.z,
    latitude: center.y,
    longitude: center.x
  };
}

function convertGeographicModelToLocalMeters(model: Object3D, origin: GeographicModelOrigin) {
  const metersPerDegreeLatitude = EARTH_RADIUS_METERS * MathUtils.DEG2RAD;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(origin.latitude * MathUtils.DEG2RAD);
  const convertedGeometries = new Set<Mesh["geometry"]>();

  model.traverse((object) => {
    if (!(object instanceof Mesh) || convertedGeometries.has(object.geometry)) return;

    const { geometry } = object;
    const position = geometry.getAttribute("position");
    if (!position) return;

    convertedGeometries.add(geometry);
    for (let index = 0; index < position.count; index += 1) {
      const longitude = position.getX(index);
      const latitude = position.getY(index);
      const elevation = position.getZ(index);
      position.setXYZ(
        index,
        (longitude - origin.longitude) * metersPerDegreeLongitude,
        elevation - origin.elevation,
        -(latitude - origin.latitude) * metersPerDegreeLatitude
      );
    }
    position.needsUpdate = true;

    const normal = geometry.getAttribute("normal");
    if (normal) {
      for (let index = 0; index < normal.count; index += 1) {
        const normalX = normal.getX(index);
        const normalY = normal.getY(index);
        const normalZ = normal.getZ(index);
        normal.setXYZ(index, normalX, normalZ, -normalY);
      }
      normal.needsUpdate = true;
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}

function normalizeMetashapeLocalModelUpAxis(model: Object3D, generator: unknown) {
  if (!METASHAPE_GENERATOR_PATTERN.test(String(generator ?? ""))) return false;

  model.updateWorldMatrix(true, true);

  let totalVertexCount = 0;
  model.traverse((object) => {
    if (object instanceof Mesh) {
      totalVertexCount += object.geometry.getAttribute("position")?.count ?? 0;
    }
  });
  if (totalVertexCount < 3) return false;

  const stride = Math.max(1, Math.floor(totalVertexCount / 50_000));
  const sample = new Vector3();
  const mean = new Vector3();
  let count = 0;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;

    for (let index = 0; index < position.count; index += stride) {
      sample.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      count += 1;
      const dx = sample.x - mean.x;
      const dy = sample.y - mean.y;
      const dz = sample.z - mean.z;
      mean.x += dx / count;
      mean.y += dy / count;
      mean.z += dz / count;
      xx += dx * (sample.x - mean.x);
      xy += dx * (sample.y - mean.y);
      xz += dx * (sample.z - mean.z);
      yy += dy * (sample.y - mean.y);
      yz += dy * (sample.z - mean.z);
      zz += dz * (sample.z - mean.z);
    }
  });

  const covariance = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ];
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  for (let iteration = 0; iteration < 12; iteration += 1) {
    let p = 0;
    let q = 1;
    if (Math.abs(covariance[0][2]) > Math.abs(covariance[p][q])) [p, q] = [0, 2];
    if (Math.abs(covariance[1][2]) > Math.abs(covariance[p][q])) [p, q] = [1, 2];
    if (Math.abs(covariance[p][q]) <= Number.EPSILON) break;

    const app = covariance[p][p];
    const aqq = covariance[q][q];
    const apq = covariance[p][q];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let axis = 0; axis < 3; axis += 1) {
      if (axis === p || axis === q) continue;
      const aip = covariance[axis][p];
      const aiq = covariance[axis][q];
      covariance[axis][p] = covariance[p][axis] = cosine * aip - sine * aiq;
      covariance[axis][q] = covariance[q][axis] = sine * aip + cosine * aiq;
    }
    covariance[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    covariance[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    covariance[p][q] = covariance[q][p] = 0;

    for (let axis = 0; axis < 3; axis += 1) {
      const vip = eigenvectors[axis][p];
      const viq = eigenvectors[axis][q];
      eigenvectors[axis][p] = cosine * vip - sine * viq;
      eigenvectors[axis][q] = sine * vip + cosine * viq;
    }
  }

  let upAxisIndex = 0;
  for (let axis = 1; axis < 3; axis += 1) {
    if (Math.abs(eigenvectors[2][axis]) > Math.abs(eigenvectors[2][upAxisIndex])) {
      upAxisIndex = axis;
    }
  }
  const upAxis = new Vector3(
    eigenvectors[0][upAxisIndex],
    eigenvectors[1][upAxisIndex],
    eigenvectors[2][upAxisIndex]
  ).normalize();
  if (upAxis.z < 0) upAxis.negate();

  // Metashape's nominal elevation is Z, but local exports can retain a tilted chunk frame.
  if (upAxis.z < 0.65) upAxis.set(0, 0, 1);
  model.applyQuaternion(new Quaternion().setFromUnitVectors(upAxis, new Vector3(0, 1, 0)));
  model.updateMatrixWorld(true);
  return true;
}

type LoadState = "querying" | "uploading" | "loading" | "deleting" | "ready" | "error" | "empty";

interface BuildingModelLocationState {
  backLabel?: string;
  backTo?: string;
  projectTitle?: string;
}

interface BuildingModelPageProps {
  mode?: "professional" | "review";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function BuildingModelPage({ mode = "professional" }: BuildingModelPageProps) {
  const location = useLocation();
  const { id = "" } = useParams();
  const isReviewWorkspace = mode === "review";
  const queryClient = useQueryClient();
  const modelInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const shouldUploadGeneratedElevationsRef = useRef(false);
  const uploadGeneratedElevationsRef = useRef<(images: ElevationImages) => void>(() => undefined);
  const [loadState, setLoadState] = useState<LoadState>("querying");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("模型加载失败，请稍后重试。");
  const [elevationImages, setElevationImages] = useState<ElevationImages>({});
  const [isImageUploadOpen, setIsImageUploadOpen] = useState(false);
  const [imageUploadFiles, setImageUploadFiles] = useState<
    Partial<Record<ModelImageSlotKey, File>>
  >({});
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const projectQuery = useQuery(projectQueryOptions(id));
  const modelQuery = useQuery(buildingModelQueryOptions(id));
  const modelImagesQuery = useQuery(buildingModelImagesQueryOptions(id));
  const modelHelpText = "左键旋转 · 滚轮缩放 · Shift+左键或右键平移";
  const project = projectQuery.data;
  const modelRecord = modelQuery.data ?? null;
  const isReadOnlyProject = project?.is_example ?? true;
  const modelUrl = modelRecord?.url ?? (project?.is_example ? EXAMPLE_BUILDING_MODEL_URL : null);
  const canManageModel = isReviewWorkspace && !isReadOnlyProject;
  const locationState = location.state as BuildingModelLocationState | null;
  const projectTitle = locationState?.projectTitle?.trim()
    || project?.name
    || (id ? `检测项目 ${id}` : "建筑三维模型");
  const backLabel = locationState?.backLabel?.trim()
    || (isReviewWorkspace ? "返回工作台" : "返回专业检测");
  const backTo = locationState?.backTo?.trim() || (isReviewWorkspace ? "/review" : "/detections");

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadBuildingModel(id, file, ({ percent }) => {
      setLoadProgress(percent);
    }),
    onMutate: () => {
      setLoadProgress(0);
      setLoadState("uploading");
    },
    onSuccess: (model) => {
      queryClient.setQueryData(buildingModelQueryKey(id), model);
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    },
    onError: (error) => {
      shouldUploadGeneratedElevationsRef.current = false;
      window.alert(getErrorMessage(error));
      setLoadProgress(null);
      setLoadState(modelUrl ? "ready" : "empty");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBuildingModel(id),
    onMutate: () => {
      setLoadProgress(null);
      setLoadState("deleting");
    },
    onSuccess: () => {
      queryClient.setQueryData(buildingModelQueryKey(id), null);
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    },
    onError: (error) => {
      window.alert(getErrorMessage(error));
      setLoadState(modelUrl ? "ready" : "empty");
    }
  });

  const imageUploadMutation = useMutation({
    mutationFn: ({ uploads }: ModelImageUploadRequest) => uploadBuildingModelImages(
      id,
      uploads,
      ({ percent }) => setImageUploadProgress(percent)
    ),
    onMutate: () => {
      setImageUploadProgress(0);
    },
    onSuccess: (images, request) => {
      queryClient.setQueryData(buildingModelImagesQueryKey(id), images);
      void queryClient.invalidateQueries({ queryKey: ["review", "detections"] });
      setImageUploadFiles({});
      if (request.closeOnSuccess) setIsImageUploadOpen(false);
      setImageUploadProgress(100);
    },
    onError: (error) => {
      window.alert(getErrorMessage(error));
      setImageUploadProgress(0);
    }
  });

  const selectedImageCount = MODEL_IMAGE_UPLOAD_SLOTS.filter(
    (slot) => imageUploadFiles[slot.key]
  ).length;

  uploadGeneratedElevationsRef.current = (images) => {
    void elevationImagesToUploads(images)
      .then((uploads) => imageUploadMutation.mutate({ uploads, closeOnSuccess: false }))
      .catch((error) => window.alert(`模型已上传，但自动生成视角图失败：${getErrorMessage(error)}`));
  };

  const submitModelImages = () => {
    const uploads = MODEL_IMAGE_UPLOAD_SLOTS.flatMap((slot) => {
      const file = imageUploadFiles[slot.key];
      return file ? [{ orientation: slot.orientation, imageKind: slot.imageKind, file }] : [];
    });
    if (uploads.length === 0) return;
    imageUploadMutation.mutate({ uploads, closeOnSuccess: true });
  };

  const handleModelFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".glb")) {
      window.alert("请选择 GLB 格式的三维模型文件。");
      return;
    }
    if (file.size > MAX_BUILDING_MODEL_BYTES) {
      window.alert("三维模型文件不能超过 1 GB。");
      return;
    }

    setElevationImages({});
    shouldUploadGeneratedElevationsRef.current = true;
    uploadMutation.mutate(file);
  };

  const handleDeleteModel = () => {
    if (
      !modelRecord
      || !window.confirm("确认删除当前三维模型？模型文件将从项目存储中永久删除。")
    ) return;

    setElevationImages({});
    deleteMutation.mutate();
  };

  useEffect(() => {
    if (modelQuery.isPending) {
      setLoadState("querying");
      return;
    }
    if (modelQuery.isError) {
      setLoadError(getErrorMessage(modelQuery.error));
      setLoadState("error");
      return;
    }

    setElevationImages({});
    setLoadProgress(null);
    setLoadState(modelUrl ? "loading" : "empty");
  }, [modelQuery.error, modelQuery.isError, modelQuery.isPending, modelUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !modelUrl) {
      resetViewRef.current = () => undefined;
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setLoadError("当前浏览器无法初始化 WebGL，请更换浏览器后重试。");
      setLoadState("error");
      return;
    }

    const scene = new Scene();
    scene.background = new Color(0x07111f);

    const camera = new PerspectiveCamera(42, 1, 0.01, 10_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = MathUtils.degToRad(5);
    controls.maxPolarAngle = MathUtils.degToRad(88);

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", "可旋转、缩放和平移的建筑三维模型");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.style.cursor = "grab";
    viewport.appendChild(renderer.domElement);

    const hemisphereLight = new HemisphereLight(0xe5f1ff, 0x17202b, 1.6);
    scene.add(hemisphereLight);

    const keyLight = new DirectionalLight(0xffffff, 2);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0x8fbaff, 0.7);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);

    let animationFrame = 0;
    let disposed = false;

    const handleContextMenu = (event: MouseEvent) => event.preventDefault();
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    const resize = () => {
      const width = Math.max(viewport.clientWidth, 1);
      const height = Math.max(viewport.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(viewport);
    resize();

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(renderFrame);
    };
    renderFrame();

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) return;

        const model = gltf.scene;
        let sourceBounds = new Box3().setFromObject(model);
        if (sourceBounds.isEmpty()) {
          setLoadError("模型文件中没有可显示的三维内容。");
          setLoadState("error");
          return;
        }

        const embeddedProjectionPackage = parseMetashapeProjectionPackage(
          gltf.parser.json.asset?.extras
        );
        const vertexGeographicOrigin = detectGeographicModelOrigin(sourceBounds);
        let normalizedMetashapeLocalModel = false;
        if (vertexGeographicOrigin) {
          convertGeographicModelToLocalMeters(model, vertexGeographicOrigin);
          sourceBounds = new Box3().setFromObject(model);
        } else if (!embeddedProjectionPackage) {
          normalizedMetashapeLocalModel = normalizeMetashapeLocalModelUpAxis(
            model,
            gltf.parser.json.asset?.generator
          );
          if (normalizedMetashapeLocalModel) {
            sourceBounds = new Box3().setFromObject(model, true);
          }
        }

        const sourceCenter = sourceBounds.getCenter(new Vector3());
        model.position.set(-sourceCenter.x, -sourceBounds.min.y, -sourceCenter.z);
        scene.add(model);

        const bounds = new Box3().setFromObject(model, normalizedMetashapeLocalModel);
        const size = bounds.getSize(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 1);
        const target = new Vector3(0, size.y * 0.45, 0);

        const grid = new GridHelper(maxDimension * 2.4, 24, 0x52759a, 0x203a54);
        grid.position.y = -maxDimension * 0.002;
        const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
        gridMaterials.forEach((material) => {
          material.transparent = true;
          material.opacity = 0.34;
        });
        scene.add(grid);

        try {
          const generatedImages = renderElevationImages(
            renderer,
            scene,
            grid,
            model,
            maxDimension
          );
          setElevationImages(generatedImages);
          if (shouldUploadGeneratedElevationsRef.current) {
            shouldUploadGeneratedElevationsRef.current = false;
            uploadGeneratedElevationsRef.current(generatedImages);
          }
        } catch {
          shouldUploadGeneratedElevationsRef.current = false;
          setElevationImages({});
        }

        const resetView = () => {
          const verticalFov = MathUtils.degToRad(camera.fov);
          const fitHeightDistance = size.y / (2 * Math.tan(verticalFov / 2));
          const fitWidthDistance = size.x / (2 * Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1));
          const distance = Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.65;
          const viewDirection = new Vector3(1, 0.62, 1).normalize();

          camera.near = Math.max(maxDimension / 10_000, 0.01);
          camera.far = maxDimension * 100;
          camera.position.copy(target).add(viewDirection.multiplyScalar(distance));
          camera.updateProjectionMatrix();

          controls.target.copy(target);
          controls.minDistance = maxDimension * 0.06;
          controls.maxDistance = maxDimension * 12;
          controls.update();
        };

        resetViewRef.current = resetView;
        resetView();
        setLoadProgress(100);
        setLoadState("ready");
      },
      (event) => {
        if (disposed || !event.total) return;
        setLoadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
      () => {
        if (!disposed) {
          shouldUploadGeneratedElevationsRef.current = false;
          setLoadError("模型文件读取失败，请重新上传有效的 GLB 文件。");
          setLoadState("error");
        }
      }
    );

    return () => {
      disposed = true;
      resetViewRef.current = () => undefined;
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);

      scene.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof LineSegments)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof Texture) value.dispose();
          });
          material.dispose();
        });
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  const busyStatus = loadState === "querying"
    ? { title: "正在读取项目模型", detail: "正在获取项目存储信息…" }
    : loadState === "uploading"
      ? { title: "正在上传三维模型", detail: `${loadProgress ?? 0}%` }
      : loadState === "deleting"
        ? { title: "正在删除三维模型", detail: "正在同步项目存储…" }
        : loadState === "loading"
          ? {
              title: "正在加载建筑模型",
              detail: loadProgress === null ? "正在准备模型资源…" : `${loadProgress}%`
            }
          : null;
  const savedImagesBySlot = new Map(
    (modelImagesQuery.data ?? []).map((image) => [
      `${image.orientation}:${image.image_kind}` as ModelImageSlotKey,
      image
    ])
  );

  return (
    <section className="building-model-page" aria-labelledby="building-model-page-title">
      <WorkspaceTitleBar
        actions={isReviewWorkspace ? (
          <>
            <input
              ref={modelInputRef}
              accept=".glb,model/gltf-binary"
              hidden
              type="file"
              onChange={handleModelFileChange}
            />
            <button
              aria-label="模型上传"
              className="button primary-action-button"
              disabled={!id || !canManageModel || uploadMutation.isPending || deleteMutation.isPending}
              title={isReadOnlyProject ? "示例项目为只读项目" : "支持 GLB 格式，文件最大 1 GB"}
              type="button"
              onClick={() => modelInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              <span className="workspace-title-bar-action-label">
                {uploadMutation.isPending ? "上传中…" : "模型上传"}
              </span>
            </button>
            <button
              aria-label="图片上传"
              className="button primary-action-button"
              disabled={!id || !canManageModel || imageUploadMutation.isPending}
              title={isReadOnlyProject ? "示例项目为只读项目" : "上传模型立体视角图、4 张立面图和 4 张含损伤标注图"}
              type="button"
              onClick={() => setIsImageUploadOpen(true)}
            >
              <Images aria-hidden="true" />
              <span className="workspace-title-bar-action-label">
                图片上传
              </span>
            </button>
            <button
              aria-label="删除三维模型"
              className="button destructive-action-button"
              disabled={!modelRecord || !canManageModel || uploadMutation.isPending || deleteMutation.isPending}
              title={isReadOnlyProject ? "示例项目为只读项目" : "删除当前三维模型"}
              type="button"
              onClick={handleDeleteModel}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </>
        ) : undefined}
        backLabel={backLabel}
        backTo={backTo}
        title={projectTitle}
        titleId="building-model-page-title"
      />

      <div className="building-model-workspace">
        <div className="building-model-viewport" ref={viewportRef}>
          <button
            aria-label="重置模型视角"
            className="building-model-viewport-reset-button"
            disabled={loadState !== "ready"}
            title="重置视角"
            type="button"
            onClick={() => resetViewRef.current()}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          {busyStatus ? (
            <div className="building-model-status" role="status">
              <span className="building-model-spinner" aria-hidden="true" />
              <strong>{busyStatus.title}</strong>
              <span>{busyStatus.detail}</span>
            </div>
          ) : null}
          {loadState === "error" ? (
            <div className="building-model-status is-error" role="alert">
              <strong>模型加载失败</strong>
              <span>{loadError}</span>
            </div>
          ) : null}
          {loadState === "empty" ? (
            <div className="building-model-status" role="status">
              <strong>暂无三维模型</strong>
              <span>{isReviewWorkspace
                ? "请使用标题栏上传按钮选择 GLB 文件。"
                : "当前项目尚未提供三维模型。"}</span>
            </div>
          ) : null}
          {loadState === "ready" ? (
            <div className="building-model-help" aria-hidden="true">
              {modelHelpText}
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        classNames={{
          backdrop: "start-detection-modal-backdrop",
          base: "start-detection-modal-content",
          wrapper: "start-detection-modal-wrapper"
        }}
        hideCloseButton
        isOpen={isImageUploadOpen}
        placement="center"
        scrollBehavior="inside"
        size="3xl"
        onOpenChange={(isOpen) => {
          if (!imageUploadMutation.isPending) setIsImageUploadOpen(isOpen);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <button
                aria-label="关闭图片上传"
                className="start-detection-modal-close back-cancel-button"
                disabled={imageUploadMutation.isPending}
                type="button"
                onClick={onClose}
              >
                <X aria-hidden="true" />
              </button>
              <ModalHeader className="start-detection-modal-header">
                <span className="start-detection-modal-title-copy">上传三维模型报告图片</span>
              </ModalHeader>
              <ModalBody className="start-detection-modal-body">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {MODEL_IMAGE_UPLOAD_SLOTS.map((slot) => {
                    const savedImage = savedImagesBySlot.get(slot.key);
                    const generatedImage = slot.imageKind === "elevation"
                      ? elevationImages[slot.orientation]
                      : undefined;
                    const previewUrl = savedImage?.url ?? generatedImage;
                    const selectedFile = imageUploadFiles[slot.key];
                    return (
                      <div
                        key={slot.key}
                        className={`grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800${slot.orientation === "overview" ? " sm:col-span-2" : ""}`}
                      >
                        <span>{slot.label}</span>
                        {previewUrl ? (
                          <img
                            alt={`${slot.label}预览`}
                            className="h-32 w-full rounded-md border border-slate-200 bg-slate-50 object-cover"
                            decoding="async"
                            src={previewUrl}
                          />
                        ) : (
                          <span className="grid h-32 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs font-normal text-slate-400">
                            暂无图片
                          </span>
                        )}
                        <span className="text-xs font-normal text-slate-500">
                          {selectedFile
                            ? `待上传：${selectedFile.name}`
                            : savedImage
                              ? `已保存：${savedImage.original_filename}`
                              : generatedImage
                                ? "已自动生成，正在保存"
                                : "尚未上传"}
                        </span>
                        <input
                          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                          className="block w-full text-xs font-normal text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold file:text-slate-800"
                          disabled={imageUploadMutation.isPending}
                          type="file"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            setImageUploadFiles((current) => {
                              const next = { ...current };
                              if (file) next[slot.key] = file;
                              else delete next[slot.key];
                              return next;
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm text-slate-500">
                  本次选择 {selectedImageCount} 张
                  {imageUploadMutation.isPending ? ` · 上传进度 ${imageUploadProgress}%` : ""}
                </p>
              </ModalBody>
              <ModalFooter className="start-detection-modal-footer">
                <button
                  className="button back-cancel-button"
                  disabled={imageUploadMutation.isPending}
                  type="button"
                  onClick={onClose}
                >
                  取消
                </button>
                <button
                  className="button primary-action-button"
                  disabled={
                    selectedImageCount === 0
                    || imageUploadMutation.isPending
                  }
                  type="button"
                  onClick={submitModelImages}
                >
                  <Upload aria-hidden="true" />
                  {imageUploadMutation.isPending ? `上传中 ${imageUploadProgress}%` : "上传所选图片"}
                </button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </section>
  );
}
