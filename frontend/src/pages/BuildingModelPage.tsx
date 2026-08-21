import { ArrowLeft, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix3,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PerspectiveCamera,
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

const buildingModelUrl = "/models/tower_residential__modern_apartment_building_metalrough.glb";

type LoadState = "loading" | "ready" | "error";

interface ImageViewState {
  scale: number;
  x: number;
  y: number;
}

const initialImageView: ImageViewState = { scale: 1, x: 0, y: 0 };

interface DefectAnnotation {
  color: number;
  id: string;
  imageUrl: string;
}

const defectAnnotations: DefectAnnotation[] = [
  {
    id: "mock-crack-01",
    color: 0xff4d5e,
    imageUrl: "/images/trial/examples/annotated/裂缝标注图.jpeg"
  },
  {
    id: "mock-spalling-01",
    color: 0xff982e,
    imageUrl: "/images/trial/examples/annotated/剥落标注图.png"
  },
  {
    id: "mock-hollow-01",
    color: 0xffd84d,
    imageUrl: "/images/trial/examples/annotated/空鼓标注图.png"
  }
];

interface BuildingModelLocationState {
  projectTitle?: string;
}

export function BuildingModelPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id = "" } = useParams();
  const viewportRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const imageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<DefectAnnotation | null>(null);
  const [imageView, setImageView] = useState<ImageViewState>(initialImageView);
  const locationState = location.state as BuildingModelLocationState | null;
  const projectTitle = locationState?.projectTitle?.trim() || (id ? `检测项目 ${id}` : "建筑三维模型");

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
  }, [selectedAnnotation?.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
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
      if (hoveredMarker) {
        hoveredMarker.material.opacity = 0.16;
        hoveredMarker.scale.setScalar(1);
      }
      hoveredMarker = marker;
      if (hoveredMarker) {
        hoveredMarker.material.opacity = 0.34;
        hoveredMarker.scale.setScalar(1.08);
      }
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
      const annotation = defectAnnotations.find((item) => item.id === annotationId);
      if (annotation) setSelectedAnnotation(annotation);
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

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(renderFrame);
    };
    renderFrame();

    const loader = new GLTFLoader();
    loader.load(
      buildingModelUrl,
      (gltf) => {
        if (disposed) return;

        const model = gltf.scene;
        const sourceBounds = new Box3().setFromObject(model);
        if (sourceBounds.isEmpty()) {
          setLoadState("error");
          return;
        }

        const sourceCenter = sourceBounds.getCenter(new Vector3());
        model.position.set(-sourceCenter.x, -sourceBounds.min.y, -sourceCenter.z);
        scene.add(model);

        const bounds = new Box3().setFromObject(model);
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
        const surfaceNormalMatrix = new Matrix3();
        const markerWidth = maxDimension * 0.09;
        const markerHeight = maxDimension * 0.07;

        const addAnnotationMarker = (
          annotation: DefectAnnotation,
          origin: Vector3,
          direction: Vector3
        ) => {
          surfaceRaycaster.set(origin, direction.normalize());
          const surfaceHit = surfaceRaycaster.intersectObject(model, true)
            .find((intersection) => Boolean(intersection.face));
          if (!surfaceHit?.face) return;

          surfaceNormalMatrix.getNormalMatrix(surfaceHit.object.matrixWorld);
          const surfaceNormal = surfaceHit.face.normal.clone()
            .applyMatrix3(surfaceNormalMatrix)
            .normalize();
          const markerMaterial = new MeshBasicMaterial({
            color: annotation.color,
            depthTest: true,
            depthWrite: false,
            opacity: 0.16,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            side: DoubleSide,
            transparent: true
          });
          const marker = new Mesh(new PlaneGeometry(markerWidth, markerHeight), markerMaterial);
          marker.position.copy(surfaceHit.point).addScaledVector(surfaceNormal, maxDimension * 0.004);
          marker.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), surfaceNormal);
          marker.renderOrder = 4;
          marker.userData.annotationId = annotation.id;

          const markerBorder = new LineSegments(
            new EdgesGeometry(marker.geometry),
            new LineBasicMaterial({ color: annotation.color, depthTest: true, transparent: true, opacity: 1 })
          );
          markerBorder.renderOrder = 5;
          marker.add(markerBorder);
          markerTargets.push(marker);
          scene.add(marker);
        };

        addAnnotationMarker(
          defectAnnotations[0],
          new Vector3(-size.x * 0.12, size.y * 0.62, bounds.max.z + maxDimension),
          new Vector3(0, 0, -1)
        );
        addAnnotationMarker(
          defectAnnotations[1],
          new Vector3(size.x * 0.15, size.y * 0.37, bounds.max.z + maxDimension),
          new Vector3(0, 0, -1)
        );
        addAnnotationMarker(
          defectAnnotations[2],
          new Vector3(bounds.max.x + maxDimension, size.y * 0.49, size.z * 0.05),
          new Vector3(-1, 0, 0)
        );

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
        if (!disposed) setLoadState("error");
      }
    );

    return () => {
      disposed = true;
      resetViewRef.current = () => undefined;
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
  }, []);

  return (
    <section className="building-model-page" aria-labelledby="building-model-page-title">
      <header className="building-model-page-header">
        <button className="building-model-back-button" type="button" onClick={() => navigate("/detections")}>
          <ArrowLeft aria-hidden="true" />
          返回专业检测
        </button>
        <div className="building-model-page-heading">
          <span>专业检测 · 三维可视化</span>
          <h1 id="building-model-page-title">{projectTitle}</h1>
        </div>
      </header>

      <div
        className={`building-model-workspace${selectedAnnotation ? " has-defect-detail" : ""}`}
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
          {loadState === "loading" ? (
            <div className="building-model-status" role="status">
              <span className="building-model-spinner" aria-hidden="true" />
              <strong>正在加载建筑模型</strong>
              <span>{loadProgress === null ? "正在准备模型资源…" : `${loadProgress}%`}</span>
            </div>
          ) : null}
          {loadState === "error" ? (
            <div className="building-model-status is-error" role="alert">
              <strong>模型加载失败</strong>
              <span>请确认浏览器支持 WebGL，并稍后重试。</span>
            </div>
          ) : null}
          <div className="building-model-help" aria-hidden="true">
            左键旋转 · 滚轮缩放 · Shift+左键或右键平移
          </div>
        </div>
        {selectedAnnotation ? (
          <aside
            aria-label="缺陷详情"
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
                  onClick={() => setSelectedAnnotation(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <img
                alt="检测结果照片"
                draggable="false"
                src={selectedAnnotation.imageUrl}
                style={{
                  transform: `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`
                }}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
