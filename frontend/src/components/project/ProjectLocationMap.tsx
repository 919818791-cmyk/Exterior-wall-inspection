import { Crosshair, LoaderCircle, MapPin, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface AMapPosition {
  getLng: () => number;
  getLat: () => number;
}

interface AMapMap {
  destroy: () => void;
  getZoom: () => number;
  on: (eventName: string, callback: (event: { lnglat?: AMapPosition }) => void) => void;
  setCenter: (position: [number, number]) => void;
  setZoom: (zoom: number) => void;
}

interface AMapMarker {
  getPosition: () => AMapPosition;
  on: (eventName: string, callback: () => void) => void;
  setPosition: (position: [number, number]) => void;
}

interface AMapGeocoder {
  getLocation: (
    address: string,
    callback: (status: string, result: { geocodes?: Array<{ location: AMapPosition }> }) => void
  ) => void;
}

interface AMapNamespace {
  Map: new (container: HTMLDivElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Geocoder: new (options: Record<string, unknown>) => AMapGeocoder;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { serviceHost: string };
  }
}

const DEFAULT_POSITION = { longitude: 114.0579, latitude: 22.5431 };
const MARKER_CONTENT = '<span class="project-map-marker" aria-hidden="true"></span>';

type MapStatus = "loading" | "ready" | "error" | "unconfigured";

let amapLoader: Promise<AMapNamespace> | null = null;

function cleanAmapCredential(value: string | undefined) {
  const credential = value?.trim();
  return !credential || credential.startsWith("your-") ? "" : credential;
}

const AMAP_KEY = cleanAmapCredential(import.meta.env.VITE_AMAP_KEY);
const AMAP_SERVICE_HOST = new URL(
  cleanAmapCredential(import.meta.env.VITE_AMAP_SERVICE_HOST) || "/_AMapService",
  window.location.origin
).toString().replace(/\/$/, "");

function loadAmap(key: string, serviceHost: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  window._AMapSecurityConfig = {
    ...window._AMapSecurityConfig,
    serviceHost
  };

  let script: HTMLScriptElement | null = null;
  amapLoader = new Promise<AMapNamespace>((resolve, reject) => {
    script = document.createElement("script");
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error("高德地图脚本加载失败。"));
    script.onerror = () => reject(new Error("高德地图脚本加载失败。"));
    document.head.append(script);
  });

  void amapLoader.catch(() => {
    script?.remove();
    amapLoader = null;
  });

  return amapLoader;
}

export function ProjectLocationMap({
  address,
  className = "",
  initialPosition,
  isEditable = true,
  locateSignal = 0,
  onPositionChange,
  usageLabel = "项目"
}: {
  address: string;
  className?: string;
  initialPosition?: { longitude: number; latitude: number } | null;
  isEditable?: boolean;
  locateSignal?: number;
  onPositionChange?: (position: { longitude: number; latitude: number }) => void;
  usageLabel?: string;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markerRef = useRef<AMapMarker | null>(null);
  const lastLocateSignalRef = useRef(0);
  const initialMapPosition = initialPosition ?? DEFAULT_POSITION;
  const hasMapCredentials = Boolean(AMAP_KEY && AMAP_SERVICE_HOST);
  const [mapStatus, setMapStatus] = useState<MapStatus>(hasMapCredentials ? "loading" : "unconfigured");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isLocating, setIsLocating] = useState(false);
  const [statusText, setStatusText] = useState(
    hasMapCredentials ? "正在连接在线地图" : "地图服务暂未配置，请联系管理员"
  );
  const [selectedPosition, setSelectedPosition] = useState(initialMapPosition);

  const setPosition = useCallback((
    position: { longitude: number; latitude: number },
    nextStatus: string,
    notify = true
  ) => {
    setSelectedPosition(position);
    setStatusText(nextStatus);
    if (notify) onPositionChange?.(position);
  }, [onPositionChange]);

  const recenter = () => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    map.setCenter([marker.getPosition().getLng(), marker.getPosition().getLat()]);
    map.setZoom(Math.max(map.getZoom(), 16));
  };

  const retryLoad = () => {
    setStatusText("正在重新加载在线地图");
    setMapStatus("loading");
    setLoadAttempt((attempt) => attempt + 1);
  };

  const locateAddress = useCallback(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    const query = address.trim();
    if (!isEditable || !map || !AMap || !query) return;

    setIsLocating(true);
    const geocoder = new AMap.Geocoder({ city: "全国" });
    geocoder.getLocation(query, (status, result) => {
      setIsLocating(false);
      const position = status === "complete" ? result.geocodes?.[0]?.location : undefined;
      if (!position) {
        setStatusText("未找到精确位置，请补充街道或门牌号后重试");
        return;
      }
      const nextPosition = { longitude: position.getLng(), latitude: position.getLat() };
      markerRef.current?.setPosition([nextPosition.longitude, nextPosition.latitude]);
      map.setCenter([nextPosition.longitude, nextPosition.latitude]);
      map.setZoom(16);
      setPosition(nextPosition, "定位成功，可点击地图或拖动标记微调");
    });
  }, [address, isEditable, setPosition]);

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;
    if (!AMAP_KEY || !AMAP_SERVICE_HOST) {
      setMapStatus("unconfigured");
      setStatusText("地图服务暂未配置，请联系管理员");
      return;
    }
    let disposed = false;
    setMapStatus("loading");

    void loadAmap(AMAP_KEY, AMAP_SERVICE_HOST)
      .then((AMap) => {
        if (disposed || !mapElementRef.current) return;
        const map = new AMap.Map(mapElementRef.current, {
          center: [initialMapPosition.longitude, initialMapPosition.latitude],
          resizeEnable: true,
          viewMode: "2D",
          zoom: initialPosition ? 16 : 12
        });
        const marker = new AMap.Marker({
          content: MARKER_CONTENT,
          draggable: isEditable,
          map,
          position: [initialMapPosition.longitude, initialMapPosition.latitude]
        });
        if (isEditable) {
          map.on("click", (event) => {
            const lnglat = event.lnglat;
            if (!lnglat) return;
            const nextPosition = { longitude: lnglat.getLng(), latitude: lnglat.getLat() };
            marker.setPosition([nextPosition.longitude, nextPosition.latitude]);
            setPosition(nextPosition, "已选择地图坐标");
          });
          marker.on("dragend", () => {
            const position = marker.getPosition();
            setPosition(
              { longitude: position.getLng(), latitude: position.getLat() },
              "已微调标记坐标"
            );
          });
        }
        mapRef.current = map;
        markerRef.current = marker;
        setPosition(
          initialMapPosition,
          initialPosition ? "已加载保存坐标" : isEditable ? `点击地图或拖动标记可选择${usageLabel}坐标` : `${usageLabel}位置标记`,
          false
        );
        setMapStatus("ready");
      })
      .catch(() => {
        if (!disposed) {
          setMapStatus("error");
          setStatusText("地图暂时无法加载，可重新加载或继续填写地址");
        }
      });

    return () => {
      disposed = true;
      markerRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  // The script should only be initialized once for this mounted map view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  useEffect(() => {
    if (mapStatus !== "ready" || !locateSignal || locateSignal === lastLocateSignalRef.current) return;
    lastLocateSignalRef.current = locateSignal;
    locateAddress();
  }, [mapStatus, locateAddress, locateSignal]);

  useEffect(() => {
    if (!initialPosition) return;

    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) {
      setPosition(initialPosition, "已加载保存坐标", false);
      return;
    }

    const currentPosition = marker.getPosition();
    const hasSamePosition =
      Math.abs(currentPosition.getLng() - initialPosition.longitude) < 0.0000001 &&
      Math.abs(currentPosition.getLat() - initialPosition.latitude) < 0.0000001;
    if (hasSamePosition) return;

    marker.setPosition([initialPosition.longitude, initialPosition.latitude]);
    map.setCenter([initialPosition.longitude, initialPosition.latitude]);
    map.setZoom(Math.max(map.getZoom(), 16));
    setPosition(initialPosition, "已加载保存坐标", false);
  }, [initialPosition, setPosition]);

  const isReady = mapStatus === "ready";
  const canLocate = isEditable && isReady && Boolean(address.trim()) && !isLocating;

  const stateContent = mapStatus === "loading"
    ? { description: "正在连接高德地图服务", title: "地图加载中…" }
    : mapStatus === "error"
      ? { description: "可重新加载，也可以继续填写地址", title: "地图暂时无法加载" }
      : { description: "请联系管理员完成地图服务配置", title: "地图服务暂未配置" };

  return (
    <aside className={`map-panel ${className}`.trim()}>
      <div className="map-panel-heading">
        <strong>在线地图</strong>
        <div className="map-panel-actions">
          <button
            disabled={!canLocate}
            type="button"
            onClick={locateAddress}
          >
            <Search aria-hidden="true" />{isLocating ? "搜索中" : "搜索定位"}
          </button>
          <button disabled={!isReady} type="button" onClick={recenter}>
            <Crosshair aria-hidden="true" />回到标记
          </button>
        </div>
      </div>
      <div aria-busy={mapStatus === "loading"} className="map-stage">
        <div
          aria-label={`${usageLabel}位置地图`}
          className={!isReady ? "map-unavailable" : undefined}
          id="project-map"
          ref={mapElementRef}
        />
        {!isReady ? <div className={`map-state map-state--${mapStatus}`} role={mapStatus === "error" ? "alert" : "status"}>
          {mapStatus === "loading"
            ? <LoaderCircle aria-hidden="true" />
            : <MapPin aria-hidden="true" />}
          <div><strong>{stateContent.title}</strong><span>{stateContent.description}</span></div>
          {mapStatus === "error" ? <button type="button" onClick={retryLoad}><RotateCcw aria-hidden="true" />重新加载</button> : null}
        </div> : null}
      </div>
      <div className="map-credit">
        <MapPin aria-hidden="true" />
        <span>{statusText}</span>
        <strong>{selectedPosition.longitude.toFixed(6)}, {selectedPosition.latitude.toFixed(6)}</strong>
      </div>
    </aside>
  );
}
