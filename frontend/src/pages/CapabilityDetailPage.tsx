import { CalendarPlus, Sparkles, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { getWeatherDaily, getWeatherHourly, type QWeatherHourlyForecast } from "@/api/weather";
import { ProjectLocationMap } from "@/components/project/ProjectLocationMap";
import {
  calculateTimeRecommendation,
  forecastDaysForDate,
  forecastHoursForDate,
  type TimeRecommendationResult
} from "@/utils/timeRecommendation";

const details = {
  crack: {
    title: "裂缝识别",
    lead: "系统对无人机采集的外墙影像进行分区分析，识别细微裂缝及连续裂缝区域，并将检测结果映射到对应立面位置。",
    image: "/images/defects/crack.jpg"
  },
  spalling: {
    title: "剥落识别",
    lead: "系统从外墙纹理、颜色和边缘变化中定位面砖、饰面层及混凝土等材料的缺失、脱落和连续剥离区域，帮助工程师快速安排复核与修补。",
    image: "/images/defects/spalling.png"
  },
  moisture: {
    title: "潮湿识别",
    lead: "系统分析外墙颜色、纹理与水迹形态，区分局部污染和疑似潮湿痕迹，帮助工程师快速锁定需要排查的节点。",
    image: "/images/defects/leakage.jpg"
  },
  corrosion: {
    title: "锈蚀识别",
    lead: "系统对金属构件和周边立面进行颜色与纹理分析，定位锈蚀区域及锈水流挂痕迹，便于持续跟踪缺陷变化。",
    image: "/images/defects/corrosion.jpg"
  },
  hollow: {
    title: "空鼓识别",
    lead: "系统对立面红外影像进行温度分布分析，并结合构造边界与可见光影像排除明显干扰，输出需要优先复核的疑似空鼓区域。",
    image: "/images/defects/hollow.JPG"
  }
} as const;

const legacyDetailRoutes: Record<string, keyof typeof details> = {
  hollowing: "hollow",
  leakage: "moisture",
  missing: "spalling"
};

function DefectDetail({ detail }: { detail: (typeof details)[keyof typeof details] }) {
  return (
    <section className="detail-hero defect-detail-hero" style={{ "--detail-hero-image": `url("${detail.image}")` } as CSSProperties}>
      <div className="detail-hero-copy">
        <h1>{detail.title}</h1>
        <p>{detail.lead}</p>
        <div className="hero-actions">
          <Link className="button primary" to="/trial"><Sparkles aria-hidden="true" />立即检测</Link>
        </div>
      </div>
    </section>
  );
}

const orientationAzimuth = {
  东: 90,
  南: 180,
  西: 270,
  北: 0,
  东南: 135,
  东北: 45,
  西南: 225,
  西北: 315
} as const;

type Orientation = keyof typeof orientationAzimuth;
type RecommendationPosition = { longitude: number; latitude: number };

function RecommendationLoadingSkeleton() {
  return (
    <div className="recommendation-loading" role="status" aria-live="polite">
      <div className="recommendation-loading-status">
        <div>
          <strong>正在生成推荐结果</strong>
          <span>正在分析天气与立面条件，请稍候</span>
        </div>
        <i aria-hidden="true" />
      </div>
      <div className="recommendation-primary recommendation-skeleton-primary" aria-hidden="true">
        <i className="recommendation-skeleton-block recommendation-skeleton-block--short" />
        <i className="recommendation-skeleton-block recommendation-skeleton-block--title" />
        <i className="recommendation-skeleton-block recommendation-skeleton-block--wide" />
      </div>
      <div className="recommendation-meta recommendation-skeleton-meta" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <div key={index}><i className="recommendation-skeleton-block recommendation-skeleton-block--short" /><i className="recommendation-skeleton-block recommendation-skeleton-block--medium" /></div>)}
      </div>
      <div className="recommendation-loading-rows" aria-hidden="true">
        <div><i className="recommendation-skeleton-block recommendation-skeleton-block--short" /><i className="recommendation-skeleton-block recommendation-skeleton-block--medium" /></div>
        <div><i className="recommendation-skeleton-block recommendation-skeleton-block--short" /><i className="recommendation-skeleton-block recommendation-skeleton-block--wide" /></div>
      </div>
    </div>
  );
}

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function TimeRecommendation() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMapMounted, setIsMapMounted] = useState(false);
  const [date, setDate] = useState(today);
  const [orientation, setOrientation] = useState<Orientation>("东");
  const [address, setAddress] = useState("");
  const [position, setPosition] = useState<RecommendationPosition | null>(null);
  const [recommendation, setRecommendation] = useState<TimeRecommendationResult | null>(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const qweatherLocation = position ? `${position.longitude.toFixed(2)},${position.latitude.toFixed(2)}` : "";
  const preciseLocation = position ? `${position.longitude.toFixed(6)},${position.latitude.toFixed(6)}` : "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let frame = 0;
    if (isDialogOpen) {
      if (!dialog.open) dialog.showModal();
      frame = window.requestAnimationFrame(() => setIsMapMounted(true));
    } else {
      setIsMapMounted(false);
      if (dialog.open) dialog.close();
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isDialogOpen]);

  function openDialog() {
    setDate(today());
    setRecommendation(null);
    setRecommendationError("");
    setIsDialogOpen(true);
  }

  function resetResult() {
    setRecommendation(null);
    setRecommendationError("");
  }

  function updatePosition(nextPosition: RecommendationPosition) {
    setPosition(nextPosition);
    resetResult();
  }

  async function queryRecommendation() {
    if (!date || !position || isQuerying) return;
    const dailyDays = forecastDaysForDate(date);
    if (!dailyDays) {
      setRecommendation(null);
      setRecommendationError("目前支持从今天起未来 30 天内的单日推荐。");
      return;
    }

    const hourlyHours = forecastHoursForDate(date);
    setIsQuerying(true);
    setRecommendation(null);
    setRecommendationError("");
    try {
      const dailyForecast = await getWeatherDaily(qweatherLocation, dailyDays);
      let hourlyItems: QWeatherHourlyForecast[] = [];
      const warnings: string[] = [];
      if (hourlyHours) {
        try {
          const hourlyForecast = await getWeatherHourly(qweatherLocation, hourlyHours);
          hourlyItems = hourlyForecast.hourly;
        } catch (error) {
          warnings.push(`逐小时预报暂不可用，已使用逐日预报估算：${readableError(error)}`);
        }
      }
      const nextRecommendation = calculateTimeRecommendation({
        date,
        latitude: position.latitude,
        longitude: position.longitude,
        orientationName: orientation,
        azimuth: orientationAzimuth[orientation],
        daily: dailyForecast.daily,
        hourly: hourlyItems
      });
      nextRecommendation.modelWarnings = [...warnings, ...nextRecommendation.modelWarnings];
      setRecommendation(nextRecommendation);
    } catch (error) {
      setRecommendationError(readableError(error));
    } finally {
      setIsQuerying(false);
    }
  }

  return <>
    <section className="detail-hero recommendation-hero"><div className="detail-hero-copy"><h1>检测时段推荐</h1><p>综合计划时间、立面朝向与气象条件，提前筛选更稳定、更安全的无人机采集窗口。</p><div className="detail-actions"><button className="button primary" type="button" onClick={openDialog}><CalendarPlus aria-hidden="true" />查询推荐时段</button></div></div></section>
    <section className="detail-section"><div className="detail-intro"><div><h2>让每次采集从合适的时间开始</h2><p className="detail-lead">系统结合计划时间、立面朝向和逐小时环境条件，对候选时段进行分级，减少强反光、温差不足与大风对采集质量的影响。</p></div><div className="detail-facts"><div><span>判断维度</span><strong>朝向、温度、风速风向、太阳辐照</strong></div><div><span>推荐结果</span><strong>优选时段、可用时段与风险提示</strong></div><div><span>适用任务</span><strong>可见光巡检、红外热成像、复飞补采</strong></div></div></div></section>
    <dialog ref={dialogRef} aria-labelledby="time-recommendation-title" className={`project-dialog recommendation-dialog detection-time-dialog${isQuerying || recommendation ? " detection-time-dialog--results" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onClose={() => setIsDialogOpen(false)}>
      <div className="dialog-heading"><h2 id="time-recommendation-title">检测时段推荐</h2><button aria-label="关闭检测时段推荐" className="icon-button" type="button" onClick={() => dialogRef.current?.close()}><X aria-hidden="true" /></button></div>
      <div className="recommendation-content">
        <div className="recommendation-form-grid recommendation-form-grid--without-project">
          <label className="recommendation-date-field"><span>日期</span><input aria-label="选择日期" className="recommendation-date-input" type="date" value={date} onChange={(event) => { setDate(event.target.value); resetResult(); }} /></label>
          <label className="recommendation-date-field"><span>立面朝向</span><select aria-label="选择立面朝向" value={orientation} onChange={(event) => { setOrientation(event.target.value as Orientation); resetResult(); }}>{(Object.keys(orientationAzimuth) as Orientation[]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        {!isQuerying && !recommendation ? <div className="recommendation-location-section">
          <label className="recommendation-date-field recommendation-address-field"><span>检测位置</span><input aria-label="输入检测位置" placeholder="输入地址后可搜索定位，也可直接点击地图" value={address} onChange={(event) => { setAddress(event.target.value); resetResult(); }} /></label>
          {isMapMounted ? <ProjectLocationMap address={address} className="recommendation-location-map" initialPosition={position} onPositionChange={updatePosition} usageLabel="检测位置" /> : null}
        </div> : null}
        {isQuerying ? <RecommendationLoadingSkeleton /> : null}
        {recommendationError ? <div className="recommendation-weather-input recommendation-weather-input--error"><span>计算失败</span><strong>{recommendationError}</strong></div> : null}
        {recommendation && position ? <div className="recommendation-results">
          <div className="recommendation-primary">
            <span>{recommendation.status}</span>
            <strong>{recommendation.primaryWindow?.label ?? "不推荐检测"}</strong>
            <small>{date} · {recommendation.headline} · {recommendation.reason}</small>
          </div>
          <div className="recommendation-meta">
            <div><span>正温差窗口</span><strong>{windowText(recommendation.positiveWindow)}</strong></div>
            <div><span>负温差窗口</span><strong>{windowText(recommendation.negativeWindow)}</strong></div>
            <div><span>最大正温差</span><strong>{formatSigned(recommendation.maxPositiveDeltaC)} ℃</strong></div>
            <div><span>最小负温差</span><strong>{recommendation.minNegativeDeltaC.toFixed(2)} ℃</strong></div>
            <div><span>墙面辐照峰值</span><strong>{recommendation.peakRadiationWm2.toFixed(0)} W/m²</strong></div>
            <div><span>辐照峰值时刻</span><strong>{recommendation.peakRadiationTime}</strong></div>
          </div>
          <div className="recommendation-weather-input"><span>地图原始坐标</span><strong>{preciseLocation}</strong></div>
          <div className="recommendation-weather-input"><span>天气条件</span><strong>{recommendation.weatherSummary}</strong></div>
          {recommendation.modelWarnings.map((warning) => <div className="recommendation-weather-input recommendation-weather-input--warning" key={warning}><span>提示</span><strong>{warning}</strong></div>)}
        </div> : null}
      </div>
      {!isQuerying ? <div className={`dialog-actions${recommendation ? " dialog-actions--complete" : ""}`}>
          {recommendation
            ? <button className="button primary" type="button" onClick={() => dialogRef.current?.close()}>完成</button>
            : <>
                <button className="button secondary" type="button" onClick={() => dialogRef.current?.close()}>取消</button>
                <button className="button primary" disabled={!date || !position} type="button" onClick={() => void queryRecommendation()}>查询推荐</button>
              </>}
        </div> : null}
    </dialog>
  </>;
}

function windowText(window: TimeRecommendationResult["positiveWindow"]) {
  if (!window) return "未达到阈值";
  const state = window.qualifies ? "有效" : "短窗口";
  return `${window.label} · ${state} · ${formatSigned(window.extremum)} ℃`;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function readableError(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "天气数据获取或推荐计算失败。";
}

export function CapabilityDetailPage() {
  const { type } = useParams();
  if (type === "time") return <TimeRecommendation />;
  if (type && type in legacyDetailRoutes) return <Navigate replace to={`/capabilities/${legacyDetailRoutes[type]}`} />;
  if (!type || !(type in details)) return <Navigate replace to="/" />;
  return <DefectDetail detail={details[type as keyof typeof details]} />;
}
