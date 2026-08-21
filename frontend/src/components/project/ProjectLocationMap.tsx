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

type AMapServiceResult = Record<string, unknown> | string;

interface AMapGeocoder {
  getAddress: (
    position: [number, number],
    callback: (status: string, result: AMapServiceResult) => void
  ) => void;
  getLocation: (
    address: string,
    callback: (status: string, result: AMapServiceResult) => void
  ) => void;
}

interface AMapPlaceSearch {
  search: (
    keyword: string,
    callback: (status: string, result: AMapServiceResult) => void
  ) => void;
}

interface AMapNamespace {
  Map: new (container: HTMLDivElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Geocoder: new (options: Record<string, unknown>) => AMapGeocoder;
  PlaceSearch: new (options: Record<string, unknown>) => AMapPlaceSearch;
  plugin: (plugins: string | string[], callback: () => void) => void;
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

function ensureAmapSearchPlugins(AMap: AMapNamespace) {
  return new Promise<AMapNamespace>((resolve, reject) => {
    AMap.plugin(["AMap.Geocoder", "AMap.PlaceSearch"], () => {
      if (typeof AMap.Geocoder === "function" && typeof AMap.PlaceSearch === "function") resolve(AMap);
      else reject(new Error("高德地图搜索插件加载失败。"));
    });
  });
}

function loadAmap(key: string, serviceHost: string) {
  if (window.AMap) return ensureAmapSearchPlugins(window.AMap);
  if (amapLoader) return amapLoader;

  window._AMapSecurityConfig = {
    ...window._AMapSecurityConfig,
    serviceHost
  };

  let script: HTMLScriptElement | null = null;
  amapLoader = new Promise<AMapNamespace>((resolve, reject) => {
    script = document.createElement("script");
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.PlaceSearch`;
    script.onload = () => {
      const AMap = window.AMap;
      if (!AMap) {
        reject(new Error("高德地图脚本加载失败。"));
        return;
      }
      void ensureAmapSearchPlugins(AMap).then(resolve, reject);
    };
    script.onerror = () => reject(new Error("高德地图脚本加载失败。"));
    document.head.append(script);
  });

  void amapLoader.catch(() => {
    script?.remove();
    amapLoader = null;
  });

  return amapLoader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAmapPosition(value: unknown) {
  if (typeof value === "string") {
    const [longitude, latitude] = value.split(",").map(Number);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? { latitude, longitude } : null;
  }
  if (Array.isArray(value)) {
    const [longitude, latitude] = value.map(Number);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? { latitude, longitude } : null;
  }
  if (!isRecord(value)) return null;

  const getLng = value.getLng;
  const getLat = value.getLat;
  const longitude = Number(typeof getLng === "function" ? getLng.call(value) : value.lng ?? value.longitude);
  const latitude = Number(typeof getLat === "function" ? getLat.call(value) : value.lat ?? value.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { latitude, longitude };
}

function findAmapResultPosition(result: AMapServiceResult) {
  if (!isRecord(result)) return null;
  const poiList = isRecord(result.poiList) ? result.poiList : null;
  const collections = [poiList?.pois, result.pois, result.tips, result.geocodes];

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!isRecord(item)) continue;
      const position = normalizeAmapPosition(item.location);
      if (position) return position;
    }
  }
  return null;
}

function findAmapFormattedAddress(result: AMapServiceResult) {
  if (!isRecord(result) || !isRecord(result.regeocode)) return "";
  const value = result.regeocode.formattedAddress ?? result.regeocode.formatted_address;
  return typeof value === "string" ? value.trim() : "";
}

export function ProjectLocationMap({
  address,
  className = "",
  initialPosition,
  isEditable = true,
  locateSignal = 0,
  onAddressChange,
  onPositionChange,
  showCredit = true,
  showToolbar = true,
  usageLabel = "项目"
}: {
  address: string;
  className?: string;
  initialPosition?: { longitude: number; latitude: number } | null;
  isEditable?: boolean;
  locateSignal?: number;
  onAddressChange?: (address: string) => void;
  onPositionChange?: (position: { longitude: number; latitude: number }) => void;
  showCredit?: boolean;
  showToolbar?: boolean;
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

  const resolveAddress = useCallback((position: { longitude: number; latitude: number }) => {
    const AMap = window.AMap;
    if (!AMap || !onAddressChange) return;

    setStatusText("已选择地图坐标，正在识别地址");
    const geocoder = new AMap.Geocoder({ extensions: "all", radius: 1000 });
    geocoder.getAddress([position.longitude, position.latitude], (_status, result) => {
      const formattedAddress = findAmapFormattedAddress(result);
      if (!formattedAddress) {
        setStatusText("已选择地图坐标，暂未识别出详细地址");
        return;
      }
      onAddressChange(formattedAddress);
      setStatusText("已选择地图坐标并识别地址");
    });
  }, [onAddressChange]);

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
    setStatusText("正在搜索地址或地点");

    const applyLocatedPosition = (nextPosition: { longitude: number; latitude: number }) => {
      markerRef.current?.setPosition([nextPosition.longitude, nextPosition.latitude]);
      map.setCenter([nextPosition.longitude, nextPosition.latitude]);
      map.setZoom(16);
      setPosition(nextPosition, "定位成功，可点击地图或拖动标记微调");
    };

    const searchPlace = () => {
      const placeSearch = new AMap.PlaceSearch({
        city: "全国",
        citylimit: false,
        extensions: "base",
        pageIndex: 1,
        pageSize: 10,
        type: ""
      });
      placeSearch.search(query, (_status, result) => {
        const position = findAmapResultPosition(result);
        setIsLocating(false);
        if (!position) {
          setStatusText("未找到匹配位置，请补充城市或地点全称后重试");
          return;
        }
        applyLocatedPosition(position);
      });
    };

    const geocoder = new AMap.Geocoder({ city: "全国" });
    geocoder.getLocation(query, (_status, result) => {
      const position = findAmapResultPosition(result);
      if (!position) {
        searchPlace();
        return;
      }
      setIsLocating(false);
      applyLocatedPosition(position);
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
            resolveAddress(nextPosition);
          });
          marker.on("dragend", () => {
            const position = marker.getPosition();
            const nextPosition = { longitude: position.getLng(), latitude: position.getLat() };
            setPosition(nextPosition, "已微调标记坐标");
            resolveAddress(nextPosition);
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
    <aside className={`map-panel${showToolbar ? "" : " map-panel--without-toolbar"} ${className}`.trim()}>
      {showToolbar ? <div className="map-panel-heading">
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
      </div> : null}
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
      {showCredit ? <div className="map-credit">
        <MapPin aria-hidden="true" />
        <span>{statusText}</span>
        <strong>{selectedPosition.longitude.toFixed(6)}, {selectedPosition.latitude.toFixed(6)}</strong>
      </div> : null}
    </aside>
  );
}
