import { RotateCcw, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  ACESFilmicToneMapping,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  HemisphereLight,
  LineSegments,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

import {
  buildingModelQueryKey,
  buildingModelQueryOptions,
  deleteBuildingModel,
  projectPhotosQueryOptions,
  projectQueryOptions,
  projectReviewedResultQueryOptions,
  uploadBuildingModel
} from "@/api/projects";
import { reviewProjectResultsQueryOptions } from "@/api/review";
import { ReportDefectBox } from "@/components/ReportDefectBox";
import { WorkspaceTitleBar } from "@/components/WorkspaceTitleBar";
import {
  buildDefectTags,
  buildMetashapeCameraIndex,
  buildReviewedReportDefectTags,
  createTagTexture,
  type DefectTag,
  EARTH_RADIUS_METERS,
  findMetashapeCamera,
  type GeographicModelOrigin,
  metashapeProjectionRay,
  type MetashapeProjectionCamera,
  parseMetashapeProjectionPackage,
  type ProjectablePhoto,
  photoProjectionRay
} from "@/utils/buildingModelTags";

const MAX_BUILDING_MODEL_BYTES = 1024 * 1024 * 1024;
const EXAMPLE_BUILDING_MODEL_URL = "/models/tower_residential__modern_apartment_building_metalrough.glb";
const MODEL_UP = new Vector3(0, 1, 0);
const MODEL_FORWARD = new Vector3(0, 0, 1);
const MIN_FACADE_HORIZONTAL_NORMAL_SQ = 0.25;

function stabilizeFacadeNormal(surfaceNormal: Vector3) {
  const normal = surfaceNormal.clone().normalize();
  const horizontalNormal = new Vector3(normal.x, 0, normal.z);

  // Photogrammetry meshes retain small ledges and uneven triangles on otherwise
  // vertical façades. Keep roof/floor normals intact, but prevent wall labels
  // from inheriting that local vertical tilt.
  if (horizontalNormal.lengthSq() >= MIN_FACADE_HORIZONTAL_NORMAL_SQ) {
    return horizontalNormal.normalize();
  }
  return normal;
}

function metashapeFacadeNormal(camera: MetashapeProjectionCamera) {
  const values = camera.cameraToGlbYUp;
  const normal = new Vector3(-values[2], 0, -values[10]);
  return normal.lengthSq() >= Number.EPSILON ? normal.normalize() : null;
}

function orientMarkerToSurface(marker: Object3D, surfaceNormal: Vector3) {
  const normal = surfaceNormal.clone().normalize();
  const up = MODEL_UP.clone().addScaledVector(normal, -MODEL_UP.dot(normal));

  // On roofs/floors world-up is parallel to the normal, so use model-forward
  // as a stable in-plane fallback. Façade labels keep their text upright.
  if (up.lengthSq() < 1e-8) {
    up.copy(MODEL_FORWARD).addScaledVector(normal, -MODEL_FORWARD.dot(normal));
  }
  up.normalize();

  const right = up.clone().cross(normal).normalize();
  up.copy(normal).cross(right).normalize();
  marker.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
}
const METASHAPE_GENERATOR_PATTERN = /^Agisoft Metashape\b/i;

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

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

interface ImageViewState {
  scale: number;
  x: number;
  y: number;
}

const initialImageView: ImageViewState = { scale: 1, x: 0, y: 0 };

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
  const focusPhotoRef = useRef<(photo: ProjectablePhoto) => boolean>(() => false);
  const imageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("querying");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("模型加载失败，请稍后重试。");
  const [selectedAnnotation, setSelectedAnnotation] = useState<DefectTag | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<ProjectablePhoto | null>(null);
  const [imageView, setImageView] = useState<ImageViewState>(initialImageView);
  const projectQuery = useQuery(projectQueryOptions(id));
  const modelQuery = useQuery(buildingModelQueryOptions(id));
  const resultsQuery = useQuery({
    ...reviewProjectResultsQueryOptions(id),
    enabled: Boolean(id && isReviewWorkspace)
  });
  const reviewedResultQuery = useQuery({
    ...projectReviewedResultQueryOptions(id, !isReviewWorkspace),
    enabled: Boolean(id && !isReviewWorkspace)
  });
  const photosQuery = useQuery({
    ...projectPhotosQueryOptions(id),
    enabled: Boolean(id && !isReviewWorkspace)
  });
  const defectTags = useMemo(
    () => isReviewWorkspace
      ? buildDefectTags(resultsQuery.data)
      : buildReviewedReportDefectTags(reviewedResultQuery.data, photosQuery.data),
    [isReviewWorkspace, photosQuery.data, resultsQuery.data, reviewedResultQuery.data]
  );
  const defectsByPhotoId = useMemo(() => {
    const groupedDefects = new Map<string, DefectTag["defects"]>();
    defectTags.forEach((tag) => {
      groupedDefects.set(tag.photo.id, [
        ...(groupedDefects.get(tag.photo.id) ?? []),
        ...tag.defects
      ]);
    });
    return groupedDefects;
  }, [defectTags]);
  const projectPhotos = useMemo<ProjectablePhoto[]>(
    () => isReviewWorkspace ? resultsQuery.data?.photos ?? [] : photosQuery.data ?? [],
    [isReviewWorkspace, photosQuery.data, resultsQuery.data?.photos]
  );
  const projectPhotoKey = useMemo(
    () => projectPhotos.map((photo) => [
      photo.id,
      photo.longitude,
      photo.latitude,
      photo.relative_altitude,
      photo.absolute_altitude,
      photo.gimbal_yaw_degree,
      photo.gimbal_pitch_degree
    ].join(":")).join("|"),
    [projectPhotos]
  );
  const defectTagKey = useMemo(
    () => defectTags.map((tag) => `${tag.id}:${tag.count}`).join("|"),
    [defectTags]
  );
  const defectTagsReady = isReviewWorkspace
    ? !resultsQuery.isPending
    : !reviewedResultQuery.isPending && !photosQuery.isPending;
  const currentTaskStatus = resultsQuery.data?.project.current_task_status ?? null;
  const resultCount = resultsQuery.data?.ai_results.length ?? 0;
  const modelHelpText = defectTags.length
    ? "点击标签查看照片 · 左键旋转 · 滚轮缩放 · Shift+左键或右键平移"
    : !isReviewWorkspace
      ? reviewedResultQuery.isError || photosQuery.isError
        ? "标签数据读取失败，当前仍可查看三维模型。"
        : "当前正式结果没有可定位的墙面标签。"
      : resultsQuery.isError
        ? "标签数据读取失败，当前仍可查看三维模型。"
        : currentTaskStatus === "pending" || currentTaskStatus === "running"
          ? "缺陷检测进行中，完成后将自动显示墙面标签。"
          : currentTaskStatus === "failed" || currentTaskStatus === "canceled"
            ? "缺陷检测未完成，暂无墙面标签。"
            : resultCount > 0
              ? "已有缺陷结果，但暂无可定位的墙面标签。"
              : currentTaskStatus === "success"
                ? "当前检测未发现缺陷，暂无墙面标签。"
                : "项目尚未生成检测结果，暂无墙面标签。";
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
    || (isReviewWorkspace ? "返回审核工作台" : "返回专业检测");
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

    setSelectedAnnotation(null);
    setSelectedPhoto(null);
    uploadMutation.mutate(file);
  };

  const handleDeleteModel = () => {
    if (
      !modelRecord
      || !window.confirm("确认删除当前三维模型？模型文件将从项目存储中永久删除。")
    ) return;

    setSelectedAnnotation(null);
    setSelectedPhoto(null);
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

    setSelectedAnnotation(null);
    setSelectedPhoto(null);
    setLoadProgress(null);
    setLoadState(modelUrl ? "loading" : "empty");
  }, [modelQuery.error, modelQuery.isError, modelQuery.isPending, modelUrl]);

  const setImageScale = (scale: number) => {
    setImageView((current) => {
      const nextScale = MathUtils.clamp(scale, 1, 5);
      return nextScale === 1
        ? initialImageView
        : { ...current, scale: nextScale };
    });
  };

  const handleImageWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;

    setImageView((current) => {
      const nextScale = MathUtils.clamp(
        current.scale * (event.deltaY < 0 ? 1.18 : 1 / 1.18),
        1,
        5
      );
      if (nextScale === 1) return initialImageView;
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio
      };
    });
  };

  const handleImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (imageView.scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: imageView.x,
      viewY: imageView.y
    };
  };

  const handleImagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setImageView((current) => ({
      ...current,
      x: drag.viewX + event.clientX - drag.startX,
      y: drag.viewY + event.clientY - drag.startY
    }));
  };

  const handleImagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (imageDragRef.current?.pointerId !== event.pointerId) return;
    imageDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    setImageView(initialImageView);
    imageDragRef.current = null;
  }, [selectedAnnotation?.id, selectedPhoto?.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !modelUrl || !defectTagsReady) {
      resetViewRef.current = () => undefined;
      focusPhotoRef.current = () => false;
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
    viewport.appendChild(renderer.domElement);

    const hemisphereLight = new HemisphereLight(0xe5f1ff, 0x17202b, 1.6);
    scene.add(hemisphereLight);

    const keyLight = new DirectionalLight(0xffffff, 2);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0x8fbaff, 0.7);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);

    const markerTargets: Array<Mesh<PlaneGeometry, MeshBasicMaterial>> = [];
    const markerRaycaster = new Raycaster();
    const pointer = new Vector2();
    let hoveredMarker: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
    let pointerDownPosition = { x: 0, y: 0 };
    let animationFrame = 0;
    let cameraTransition: {
      duration: number;
      endPosition: Vector3;
      endTarget: Vector3;
      startPosition: Vector3;
      startTarget: Vector3;
      startedAt: number;
    } | null = null;
    let disposed = false;

    const findMarker = (event: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1
      );
      markerRaycaster.setFromCamera(pointer, camera);
      return markerRaycaster.intersectObjects(markerTargets, false)[0]?.object as
        | Mesh<PlaneGeometry, MeshBasicMaterial>
        | undefined;
    };

    const setMarkerHover = (marker: Mesh<PlaneGeometry, MeshBasicMaterial> | null) => {
      if (hoveredMarker === marker) return;
      hoveredMarker = marker;
      renderer.domElement.style.cursor = hoveredMarker ? "pointer" : "grab";
    };

    const handlePointerMove = (event: PointerEvent) => setMarkerHover(findMarker(event) ?? null);
    const handlePointerLeave = () => setMarkerHover(null);
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();
    const handlePointerDown = (event: PointerEvent) => {
      pointerDownPosition = { x: event.clientX, y: event.clientY };
    };
    const handleClick = (event: MouseEvent) => {
      const dragDistance = Math.hypot(
        event.clientX - pointerDownPosition.x,
        event.clientY - pointerDownPosition.y
      );
      if (dragDistance > 5) return;
      const marker = findMarker(event);
      if (!marker) return;
      const annotationId = String(marker.userData.annotationId ?? "");
      const annotation = defectTags.find((item) => item.id === annotationId);
      if (annotation) {
        setSelectedPhoto(null);
        setSelectedAnnotation(annotation);
      }
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("click", handleClick);
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

    const renderFrame = (timestamp: number) => {
      if (cameraTransition) {
        const progress = MathUtils.clamp(
          (timestamp - cameraTransition.startedAt) / cameraTransition.duration,
          0,
          1
        );
        const eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(
          cameraTransition.startPosition,
          cameraTransition.endPosition,
          eased
        );
        controls.target.lerpVectors(
          cameraTransition.startTarget,
          cameraTransition.endTarget,
          eased
        );
        if (progress >= 1) cameraTransition = null;
      }
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(renderFrame);
    };
    renderFrame(performance.now());

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
        const geographicOrigin = vertexGeographicOrigin ?? embeddedProjectionPackage?.origin ?? null;
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

        model.updateWorldMatrix(true, true);
        const surfaceRaycaster = new Raycaster();
        surfaceRaycaster.firstHitOnly = true;
        const metashapeCameraIndex = buildMetashapeCameraIndex(
          embeddedProjectionPackage?.cameras ?? []
        );
        if (
          (geographicOrigin || embeddedProjectionPackage)
          && (defectTags.length || projectPhotos.length)
        ) {
          const acceleratedGeometries = new Set<BufferGeometry>();
          model.traverse((object) => {
            if (!(object instanceof Mesh) || acceleratedGeometries.has(object.geometry)) return;
            acceleratedGeometries.add(object.geometry);
            object.geometry.computeBoundsTree();
          });
        }

        const findPhotoSurface = (
          photo: ProjectablePhoto,
          normalizedImagePoints: Array<{ x: number; y: number }>
        ) => {
          const points = normalizedImagePoints.length
            ? normalizedImagePoints
            : [{ x: 0.5, y: 0.5 }];
          const projections = points.map((point) => ({
            pitchAdjustment: 0,
            point,
            yawAdjustment: 0
          }));
          const center = points[0];
          [-2, 2, -4, 4, -6, 6].forEach((yawAdjustment) => {
            projections.push({ pitchAdjustment: 0, point: center, yawAdjustment });
          });
          [-3, 3].forEach((pitchAdjustment) => {
            projections.push({ pitchAdjustment, point: center, yawAdjustment: 0 });
          });

          let surfaceHit: ReturnType<Raycaster["intersectObject"]>[number] | undefined;
          let surfaceRayOrigin: Vector3 | undefined;
          const metashapeCamera = findMetashapeCamera(
            metashapeCameraIndex,
            photo.original_filename
          );
          const projectedFacadeNormal = metashapeCamera
            ? metashapeFacadeNormal(metashapeCamera)
            : null;
          if (metashapeCamera) {
            for (const point of points) {
              const ray = metashapeProjectionRay(metashapeCamera, point, model.position);
              surfaceRaycaster.set(ray.origin, ray.direction);
              surfaceHit = surfaceRaycaster.intersectObject(model, true)
                .find((intersection) => Boolean(intersection.face));
              if (surfaceHit) {
                surfaceRayOrigin = ray.origin;
                break;
              }
            }
          }
          if (!surfaceHit && geographicOrigin) {
            for (const projection of projections) {
              const ray = photoProjectionRay(
                photo,
                projection.point,
                geographicOrigin,
                model.position,
                projection.yawAdjustment,
                projection.pitchAdjustment
              );
              if (!ray) break;
              surfaceRaycaster.set(ray.origin, ray.direction);
              surfaceHit = surfaceRaycaster.intersectObject(model, true)
                .find((intersection) => Boolean(intersection.face));
              if (surfaceHit) {
                surfaceRayOrigin = ray.origin;
                break;
              }
            }
          }
          if (!surfaceHit && geographicOrigin) {
            const ray = photoProjectionRay(photo, center, geographicOrigin, model.position);
            if (ray) {
              const fallbackTarget = bounds.getCenter(new Vector3());
              const horizontalDistance = Math.hypot(
                fallbackTarget.x - ray.origin.x,
                fallbackTarget.z - ray.origin.z
              );
              const horizontalDirection = Math.hypot(ray.direction.x, ray.direction.z);
              fallbackTarget.y = MathUtils.clamp(
                ray.origin.y + ray.direction.y * horizontalDistance / Math.max(horizontalDirection, 0.001),
                bounds.min.y,
                bounds.max.y
              );
              surfaceRaycaster.set(ray.origin, fallbackTarget.sub(ray.origin).normalize());
              surfaceHit = surfaceRaycaster.intersectObject(model, true)
                .find((intersection) => Boolean(intersection.face));
              if (surfaceHit) surfaceRayOrigin = ray.origin;
            }
          }
          return surfaceHit?.face
            ? { projectedFacadeNormal, surfaceHit, surfaceRayOrigin }
            : null;
        };

        const photoAltitudes = projectPhotos
          .map((photo) => photo.relative_altitude ?? photo.absolute_altitude)
          .filter((value): value is number => value !== null && Number.isFinite(value));
        const minimumPhotoAltitude = photoAltitudes.length ? Math.min(...photoAltitudes) : 0;
        const maximumPhotoAltitude = photoAltitudes.length ? Math.max(...photoAltitudes) : 0;
        const photoFocusTargets = new Map<string, { point: Vector3; viewDirection: Vector3 }>();

        projectPhotos.forEach((photo, index) => {
          const projection = findPhotoSurface(photo, [
            { x: 0.5, y: 0.5 },
            { x: 0.35, y: 0.5 },
            { x: 0.65, y: 0.5 },
            { x: 0.5, y: 0.35 },
            { x: 0.5, y: 0.65 }
          ]);
          if (projection) {
            const { surfaceHit, surfaceRayOrigin } = projection;
            const surfaceNormal = (surfaceHit.normal ?? surfaceHit.face!.normal)
              .clone()
              .transformDirection(surfaceHit.object.matrixWorld);
            const viewDirection = surfaceRayOrigin
              ? surfaceRayOrigin.clone().sub(surfaceHit.point).normalize()
              : surfaceNormal.normalize();
            photoFocusTargets.set(photo.id, {
              point: surfaceHit.point.clone(),
              viewDirection
            });
            return;
          }

          const fallbackYaw = projectPhotos.length > 1
            ? index / projectPhotos.length * 360
            : 45;
          const yaw = MathUtils.degToRad(photo.gimbal_yaw_degree ?? fallbackYaw);
          const viewDirection = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).normalize();
          const point = bounds.getCenter(new Vector3());
          if (Math.abs(viewDirection.x) >= Math.abs(viewDirection.z)) {
            point.x = viewDirection.x >= 0 ? bounds.max.x : bounds.min.x;
          } else {
            point.z = viewDirection.z >= 0 ? bounds.max.z : bounds.min.z;
          }
          const altitude = photo.relative_altitude ?? photo.absolute_altitude;
          const altitudeProgress = (
            altitude !== null
            && maximumPhotoAltitude - minimumPhotoAltitude > 0.5
          ) ? MathUtils.clamp(
              (altitude - minimumPhotoAltitude) / (maximumPhotoAltitude - minimumPhotoAltitude),
              0,
              1
            ) : 0.5;
          point.y = bounds.min.y + size.y * (0.15 + altitudeProgress * 0.7);
          photoFocusTargets.set(photo.id, { point, viewDirection });
        });

        focusPhotoRef.current = (photo) => {
          const focusTarget = photoFocusTargets.get(photo.id);
          if (!focusTarget) return false;
          const viewDirection = focusTarget.viewDirection.clone().normalize();
          if (Math.abs(viewDirection.y) > 0.85) {
            viewDirection.y = Math.sign(viewDirection.y) * 0.35;
            viewDirection.normalize();
          }
          const endTarget = focusTarget.point.clone();
          const endPosition = endTarget.clone()
            .addScaledVector(viewDirection, maxDimension * 0.3)
            .addScaledVector(MODEL_UP, maxDimension * 0.035);
          cameraTransition = {
            duration: 650,
            endPosition,
            endTarget,
            startPosition: camera.position.clone(),
            startTarget: controls.target.clone(),
            startedAt: performance.now()
          };
          return true;
        };

        const addDefectTag = (tag: DefectTag) => {
          const projection = findPhotoSurface(tag.photo, tag.normalizedImagePoints);
          if (!projection) return;
          const { projectedFacadeNormal, surfaceHit, surfaceRayOrigin } = projection;

          const surfaceNormal = (surfaceHit.normal ?? surfaceHit.face!.normal)
            .clone()
            .transformDirection(surfaceHit.object.matrixWorld);
          if (
            surfaceRayOrigin
            && surfaceNormal.dot(surfaceRayOrigin.clone().sub(surfaceHit.point)) < 0
          ) {
            surfaceNormal.negate();
          }

          const texture = createTagTexture(`${tag.label}X${tag.count}`);
          if (!texture) return;
          const markerMaterial = new MeshBasicMaterial({
            depthTest: true,
            depthWrite: false,
            map: texture,
            opacity: 1,
            side: DoubleSide,
            toneMapped: false,
            transparent: true
          });
          const markerHeight = maxDimension * 0.015;
          const marker = new Mesh(
            new PlaneGeometry(markerHeight * 4, markerHeight),
            markerMaterial
          );
          const markerNormal = projectedFacadeNormal ?? stabilizeFacadeNormal(
            surfaceRayOrigin?.clone().sub(surfaceHit.point) ?? surfaceNormal
          );
          if (
            surfaceRayOrigin
            && markerNormal.dot(surfaceRayOrigin.clone().sub(surfaceHit.point)) < 0
          ) {
            markerNormal.negate();
          }
          marker.position.copy(surfaceHit.point).addScaledVector(markerNormal, markerHeight * 0.5);
          orientMarkerToSurface(marker, markerNormal);
          marker.renderOrder = 10;
          marker.userData.annotationId = tag.id;
          markerTargets.push(marker);
          scene.add(marker);
        };

        defectTags.forEach(addDefectTag);

        const resetView = () => {
          cameraTransition = null;
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
          setLoadError("模型文件读取失败，请重新上传有效的 GLB 文件。");
          setLoadState("error");
        }
      }
    );

    return () => {
      disposed = true;
      resetViewRef.current = () => undefined;
      focusPhotoRef.current = () => false;
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);

      scene.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof LineSegments)) return;
        if (object instanceof Mesh) object.geometry.disposeBoundsTree();
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
  }, [defectTagKey, defectTagsReady, modelUrl, projectPhotoKey]);

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
  const selectedImageTransform = (
    `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`
  );
  const activePhoto = selectedAnnotation?.photo ?? selectedPhoto;
  const activePhotoUrl = selectedAnnotation?.imageUrl
    ?? selectedPhoto?.preview_url
    ?? selectedPhoto?.thumbnail_url
    ?? "";
  const activePhotoDefects = selectedAnnotation?.defects
    ?? (selectedPhoto ? defectsByPhotoId.get(selectedPhoto.id) ?? [] : []);
  const defectivePhotoCount = projectPhotos.reduce(
    (count, photo) => count + ((defectsByPhotoId.get(photo.id)?.length ?? 0) > 0 ? 1 : 0),
    0
  );
  const totalDefectCount = Array.from(defectsByPhotoId.values()).reduce(
    (count, defects) => count + defects.length,
    0
  );

  const handleProjectPhotoSelect = (photo: ProjectablePhoto) => {
    if (!photo.preview_url && !photo.thumbnail_url) return;
    focusPhotoRef.current(photo);
    setSelectedAnnotation(null);
    setSelectedPhoto(photo);
  };

  const closePhotoDetail = () => {
    setSelectedAnnotation(null);
    setSelectedPhoto(null);
  };

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
              aria-label="上传三维模型"
              className="building-model-header-action"
              disabled={!id || !canManageModel || uploadMutation.isPending || deleteMutation.isPending}
              title={isReadOnlyProject ? "示例项目为只读项目" : "支持 GLB 格式，文件最大 1 GB"}
              type="button"
              onClick={() => modelInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
            </button>
            <button
              aria-label="删除三维模型"
              className="building-model-header-action is-danger"
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

      <div
        className={`building-model-workspace${activePhoto ? " has-defect-detail" : ""}`}
      >
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
        {activePhoto ? (
          <aside
            aria-label={selectedAnnotation
              ? `${selectedAnnotation.label} ${selectedAnnotation.count} 处缺陷照片`
              : `${activePhoto.original_filename}照片预览`}
            className="building-defect-detail-card"
            role="dialog"
          >
            <div
              className={`building-defect-image-viewport${imageView.scale > 1 ? " is-zoomed" : ""}`}
              onPointerCancel={handleImagePointerEnd}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerEnd}
              onWheel={handleImageWheel}
            >
              <div
                className="building-defect-image-actions"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  aria-label="缩小检测图片"
                  disabled={imageView.scale <= 1}
                  title="缩小"
                  type="button"
                  onClick={() => setImageScale(imageView.scale / 1.25)}
                >
                  <ZoomOut aria-hidden="true" />
                </button>
                <button
                  aria-label="放大检测图片"
                  disabled={imageView.scale >= 5}
                  title="放大"
                  type="button"
                  onClick={() => setImageScale(imageView.scale * 1.25)}
                >
                  <ZoomIn aria-hidden="true" />
                </button>
                <button
                  aria-label="关闭缺陷详情"
                  title="关闭"
                  type="button"
                  onClick={closePhotoDetail}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <div
                className="trial-annotated-photo building-defect-annotated-photo"
                style={{ transform: selectedImageTransform }}
              >
                <img
                  alt={selectedAnnotation
                    ? `${activePhoto.original_filename}，${selectedAnnotation.label} ${selectedAnnotation.count} 处`
                    : activePhoto.original_filename}
                  draggable="false"
                  src={activePhotoUrl}
                />
                {activePhotoDefects.map((defect, index) => (
                  <ReportDefectBox
                    key={defect.id || `${activePhoto.id}:box:${index}`}
                    defect={defect}
                    imageHeight={activePhoto.image_height}
                    imageWidth={activePhoto.image_width}
                    fallbackIndex={index}
                  />
                ))}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {projectPhotos.length > 0 ? (
        <section className="building-model-photo-section" aria-label="项目全部照片">
          <p className="building-model-photo-summary">
            {projectPhotos.length}张照片，{defectivePhotoCount}张检测出缺陷的照片，{totalDefectCount}个缺陷
          </p>
          <div className="building-model-photo-gallery" aria-label="项目照片缩略图">
            {projectPhotos.map((photo) => {
              const thumbnailUrl = photo.thumbnail_url ?? photo.preview_url ?? "";
              const isActive = activePhoto?.id === photo.id;
              return (
                <button
                  key={photo.id}
                  aria-label={`查看照片：${photo.original_filename}`}
                  aria-pressed={isActive}
                  className={isActive ? "is-active" : ""}
                  disabled={!thumbnailUrl}
                  type="button"
                  onClick={() => handleProjectPhotoSelect(photo)}
                >
                  {thumbnailUrl ? (
                    <img
                      alt=""
                      decoding="async"
                      loading="lazy"
                      src={thumbnailUrl}
                    />
                  ) : <span aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}
