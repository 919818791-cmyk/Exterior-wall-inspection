import { CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import gsap from "gsap";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { getWeatherDaily, getWeatherHourly, type QWeatherHourlyForecast } from "@/api/weather";
import { ProjectLocationMap } from "@/components/project/ProjectLocationMap";
import { usePublicHeroAnimation } from "@/hooks/usePublicHeroAnimation";
import { useAuthStore } from "@/stores/useAuthStore";
import {
  calculateTimeRecommendation,
  forecastDaysForDate,
  forecastHoursForDate,
  type TimeRecommendationResult
} from "@/utils/timeRecommendation";

const details = {
  crack: {
    title: "细微裂缝，也不放过。",
    lead: "系统对无人机采集的外墙影像进行分区分析，识别细微裂缝及连续裂缝区域，并将检测结果映射到对应立面位置。",
    images: ["/images/optimized/crack-detail-1.webp"]
  },
  spalling: {
    title: "发现每一处缺失",
    lead: "系统从外墙纹理、颜色和边缘变化中定位面砖、饰面层及混凝土等材料的缺失、脱落和连续剥离区域，帮助工程师快速安排复核与修补。",
    images: ["/images/optimized/spalling-detail-1.webp", "/images/optimized/spalling-detail-2.webp"]
  },
  moisture: {
    title: "潮湿识别",
    lead: "系统分析外墙颜色、纹理与水迹形态，区分局部污染和疑似潮湿痕迹，帮助工程师快速锁定需要排查的节点。",
    images: ["/images/optimized/moisture-detail.webp"],
    comingSoon: true
  },
  corrosion: {
    title: "锈蚀识别",
    lead: "系统对金属构件和周边立面进行颜色与纹理分析，定位锈蚀区域及锈水流挂痕迹，便于持续跟踪缺陷变化。",
    images: ["/images/optimized/corrosion-detail.webp"],
    comingSoon: true
  },
  hollow: {
    title: "看见表面之下",
    lead: "系统对立面红外影像进行温度分布分析，并结合构造边界与可见光影像排除明显干扰，输出疑似空鼓区域。",
    images: ["/images/optimized/hollow-detail.webp"]
  }
} as const;

const legacyDetailRoutes: Record<string, keyof typeof details> = {
  hollowing: "hollow",
  leakage: "moisture",
  missing: "spalling"
};

function StaggeredLead({ children }: { children: string }) {
  const lines = children.match(/[^，。！？]+[，。！？]?/g) ?? [children];

  return (
    <p className="staggered-lead">
      {lines.map((line, index) => (
        <span
          key={line}
          className="staggered-lead-line"
          style={{ "--line-index": index } as CSSProperties}
        >
          {line}
        </span>
      ))}
    </p>
  );
}

function DefectDetail({ detail }: { detail: (typeof details)[keyof typeof details] }) {
  const heroRef = useRef<HTMLElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const previousImageIndexRef = useRef(0);
  const slidesInitializedRef = useRef(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  usePublicHeroAnimation(heroRef, detail.title);

  useLayoutEffect(() => {
    const slides = slideRefs.current.filter((slide): slide is HTMLDivElement => Boolean(slide));
    if (!slides.length) return undefined;

    if (!slidesInitializedRef.current) {
      gsap.set(slides, { autoAlpha: 0, scale: 1.035, zIndex: 0 });
      gsap.set(slides[activeImageIndex], { autoAlpha: 1, scale: 1, zIndex: 1 });
      slidesInitializedRef.current = true;
      previousImageIndexRef.current = activeImageIndex;
      return undefined;
    }

    const previousImageIndex = previousImageIndexRef.current;
    if (previousImageIndex === activeImageIndex) return undefined;

    const previousSlide = slides[previousImageIndex];
    const nextSlide = slides[activeImageIndex];
    if (!previousSlide || !nextSlide) return undefined;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      gsap.set(slides, { autoAlpha: 0, scale: 1, zIndex: 0 });
      gsap.set(nextSlide, { autoAlpha: 1, zIndex: 1 });
      previousImageIndexRef.current = activeImageIndex;
      return undefined;
    }

    gsap.set(nextSlide, { autoAlpha: 0, scale: 1.035, zIndex: 2 });
    gsap.set(previousSlide, { zIndex: 1 });
    const timeline = gsap.timeline({
      defaults: { duration: 1.35, ease: "power2.inOut" },
      onComplete: () => gsap.set(previousSlide, { zIndex: 0 })
    });
    timeline
      .to(previousSlide, { autoAlpha: 0, scale: 1.018 }, 0)
      .to(nextSlide, { autoAlpha: 1, scale: 1 }, 0);

    previousImageIndexRef.current = activeImageIndex;
    return () => {
      timeline.kill();
    };
  }, [activeImageIndex]);

  useEffect(() => {
    if (detail.images.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setActiveImageIndex((currentIndex) => (currentIndex + 1) % detail.images.length);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [activeImageIndex, detail.images.length]);

  function showPreviousImage() {
    setActiveImageIndex((currentIndex) => (currentIndex - 1 + detail.images.length) % detail.images.length);
  }

  function showNextImage() {
    setActiveImageIndex((currentIndex) => (currentIndex + 1) % detail.images.length);
  }

  return (
    <section ref={heroRef} className="detail-hero defect-detail-hero">
      <div className="defect-hero-backdrop" aria-hidden="true">
        {detail.images.map((image, index) => (
          <div
            key={image}
            ref={(node) => {
              slideRefs.current[index] = node;
            }}
            className="defect-hero-slide"
          >
            <img
              alt=""
              decoding="async"
              fetchPriority={index === 0 ? "high" : "auto"}
              loading={index === 0 ? "eager" : "lazy"}
              src={image}
            />
          </div>
        ))}
        <div className="defect-hero-shade" />
      </div>
      <div className="detail-hero-copy">
        <h1>{detail.title}</h1>
        <StaggeredLead>{detail.lead}</StaggeredLead>
        <div className="hero-actions">
          {"comingSoon" in detail && detail.comingSoon ? (
            <button className="button capability-coming-soon-button" disabled type="button">敬请期待</button>
          ) : (
            <Link className="button primary" to="/trials/new"><Sparkles aria-hidden="true" />上传照片开始体验</Link>
          )}
        </div>
      </div>
      {detail.images.length > 1 ? (
        <div className="defect-hero-controls" aria-label={`${detail.title}背景图切换`} role="group">
          <button aria-label="上一张背景图" type="button" onClick={showPreviousImage}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <div className="defect-hero-dots">
            {detail.images.map((image, index) => (
              <button
                key={image}
                aria-current={index === activeImageIndex ? "true" : undefined}
                aria-label={`切换到第 ${index + 1} 张背景图`}
                className={index === activeImageIndex ? "is-active" : ""}
                type="button"
                onClick={() => setActiveImageIndex(index)}
              />
            ))}
          </div>
          <button aria-label="下一张背景图" type="button" onClick={showNextImage}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
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
const recommendationCalculationSteps = [
  { title: "确定参与计算的时段", detail: "正在筛选所选日期的有效预报时段…" },
  { title: "建立气温变化曲线", detail: "正在拟合逐时气温变化…" },
  { title: "计算墙面太阳辐照", detail: "正在结合立面朝向计算太阳辐照…" },
  { title: "计算风速散热影响", detail: "正在评估风速对墙面的散热影响…" },
  { title: "判断正温差窗口", detail: "正在识别适合检测的正温差时段…" },
  { title: "判断负温差窗口", detail: "正在识别适合检测的负温差时段…" }
] as const;
const recommendationCalculationStepCount = recommendationCalculationSteps.length;
const recommendationCalculationStepDuration = 550;
const recommendationCalculationCompletionHold = 1500;

function RecommendationCalculationProgress({ activeStep }: { activeStep: number }) {
  return (
    <section className="recommendation-calculation-section" aria-labelledby="recommendation-running-calculation-title">
      <h3 className="recommendation-section-title" id="recommendation-running-calculation-title">计算过程</h3>
      <div className="recommendation-calculation" role="status" aria-live="polite">
        <ol>
          {recommendationCalculationSteps.map((step, index) => (
            <li className={index < activeStep ? "is-complete" : index === activeStep ? "is-current" : ""} key={step.title}>
              <span>{index < activeStep ? <Check aria-hidden="true" /> : index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                {index <= activeStep ? <p>{step.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateFromToday(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function TimeRecommendationDialog({ openSignal }: { openSignal: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const authStatus = useAuthStore((state) => state.status);
  const { requestAuthentication } = useOutletContext<{
    requestAuthentication: (onAuthenticated?: () => void) => void;
  }>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMapMounted, setIsMapMounted] = useState(false);
  const [date, setDate] = useState(today);
  const [orientation, setOrientation] = useState<Orientation>("东");
  const [address, setAddress] = useState("");
  const [locateSignal, setLocateSignal] = useState(0);
  const [position, setPosition] = useState<RecommendationPosition | null>(null);
  const [isPositionConfirmed, setIsPositionConfirmed] = useState(false);
  const [recommendation, setRecommendation] = useState<TimeRecommendationResult | null>(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [calculationProgressStep, setCalculationProgressStep] = useState(0);
  const [isCalculationAnimationComplete, setIsCalculationAnimationComplete] = useState(false);
  const [isCalculationDetailsExpanded, setIsCalculationDetailsExpanded] = useState(false);
  const earliestDate = today();
  const latestDate = dateFromToday(29);
  const showsTwoRecommendationWindows = Boolean(
    recommendation?.recommendationLevel === "优选时段" && recommendation.usableWindow
  );

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

  useEffect(() => {
    if (openSignal > 0) openDialog();
  }, [openSignal]);

  useEffect(() => {
    if (!isQuerying) {
      setCalculationProgressStep(0);
      setIsCalculationAnimationComplete(false);
      return undefined;
    }
    setCalculationProgressStep(0);
    setIsCalculationAnimationComplete(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCalculationProgressStep(recommendationCalculationStepCount);
      setIsCalculationAnimationComplete(true);
      return undefined;
    }

    let nextStep = 0;
    let completionTimer = 0;
    const timer = window.setInterval(() => {
      nextStep = Math.min(nextStep + 1, recommendationCalculationStepCount);
      setCalculationProgressStep(nextStep);
      if (nextStep >= recommendationCalculationStepCount) {
        window.clearInterval(timer);
        completionTimer = window.setTimeout(
          () => setIsCalculationAnimationComplete(true),
          recommendationCalculationCompletionHold
        );
      }
    }, recommendationCalculationStepDuration);
    return () => {
      window.clearInterval(timer);
      if (completionTimer) window.clearTimeout(completionTimer);
    };
  }, [isQuerying]);

  useEffect(() => {
    if (!isQuerying || !isCalculationAnimationComplete || (!recommendation && !recommendationError)) return;
    setIsQuerying(false);
  }, [isQuerying, isCalculationAnimationComplete, recommendation, recommendationError]);

  function openDialog() {
    if (authStatus !== "authenticated") {
      requestAuthentication(openRecommendationDialog);
      return;
    }
    openRecommendationDialog();
  }

  function openRecommendationDialog() {
    setDate(today());
    setLocateSignal(0);
    setRecommendation(null);
    setRecommendationError("");
    setIsCalculationDetailsExpanded(false);
    setIsDialogOpen(true);
  }

  function resetResult() {
    setRecommendation(null);
    setRecommendationError("");
    setIsCalculationDetailsExpanded(false);
  }

  function updatePosition(nextPosition: RecommendationPosition) {
    setPosition(nextPosition);
    setIsPositionConfirmed(true);
    resetResult();
  }

  function requestDialogClose() {
    if (isQuerying && !window.confirm("推荐仍在计算，确认关闭？请求会在后台继续完成，期间请勿重复查询。")) return;
    dialogRef.current?.close();
  }

  function queryRecommendation() {
    if (!date || !position || !isPositionConfirmed || isQuerying) return;
    if (authStatus !== "authenticated") {
      dialogRef.current?.close();
      requestAuthentication(() => {
        setIsDialogOpen(true);
        void runRecommendationQuery(position);
      });
      return;
    }
    void runRecommendationQuery(position);
  }

  async function runRecommendationQuery(queryPosition: RecommendationPosition) {
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
    setIsCalculationDetailsExpanded(false);
    try {
      const queryLocation = `${queryPosition.longitude.toFixed(2)},${queryPosition.latitude.toFixed(2)}`;
      const dailyForecast = await getWeatherDaily(queryLocation, dailyDays);
      let hourlyItems: QWeatherHourlyForecast[] = [];
      const warnings: string[] = [];
      if (hourlyHours) {
        try {
          const hourlyForecast = await getWeatherHourly(queryLocation, hourlyHours);
          hourlyItems = hourlyForecast.hourly;
        } catch (error) {
          warnings.push(`逐小时预报暂不可用，已使用逐日预报估算：${readableError(error)}`);
        }
      }
      const nextRecommendation = calculateTimeRecommendation({
        date,
        latitude: queryPosition.latitude,
        longitude: queryPosition.longitude,
        orientationName: orientation,
        azimuth: orientationAzimuth[orientation],
        daily: dailyForecast.daily,
        hourly: hourlyItems
      });
      nextRecommendation.modelWarnings = [...warnings, ...nextRecommendation.modelWarnings];
      setRecommendation(nextRecommendation);
    } catch (error) {
      setRecommendationError(readableError(error));
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="time-recommendation-title" className={`project-dialog recommendation-dialog detection-time-dialog${isQuerying ? " detection-time-dialog--loading" : recommendation ? ` detection-time-dialog--results${showsTwoRecommendationWindows ? " detection-time-dialog--two-windows" : ""}${isCalculationDetailsExpanded ? "" : " detection-time-dialog--details-collapsed"}` : ""}`} onCancel={(event) => { event.preventDefault(); requestDialogClose(); }} onClose={() => setIsDialogOpen(false)}>
      <div className="dialog-heading"><div className="recommendation-dialog-title"><CalendarClock aria-hidden="true" className="recommendation-dialog-title-icon" /><h2 id="time-recommendation-title">检测时段推荐</h2></div><button aria-label="关闭检测时段推荐" className="icon-button" type="button" onClick={requestDialogClose}><X aria-hidden="true" /></button></div>
      <div className="recommendation-content">
        <div className="recommendation-form-grid recommendation-form-grid--without-project">
          <label className="recommendation-date-field"><span>日期</span><input aria-label="选择日期" className="recommendation-date-input" disabled={Boolean(recommendation) || isQuerying} max={latestDate} min={earliestDate} type="date" value={date} onChange={(event) => { setDate(event.target.value); resetResult(); }} /></label>
          <label className="recommendation-date-field"><span>立面朝向</span><div className="recommendation-select-control"><select aria-label="选择立面朝向" disabled={Boolean(recommendation) || isQuerying} value={orientation} onChange={(event) => { setOrientation(event.target.value as Orientation); resetResult(); }}>{(Object.keys(orientationAzimuth) as Orientation[]).map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
        </div>
        <div className={`recommendation-location-section${isQuerying ? " is-querying" : ""}`}>
          <label className="recommendation-date-field recommendation-address-field"><span>检测位置</span><input aria-label="输入检测位置" disabled={Boolean(recommendation) || isQuerying} placeholder="输入地址后按回车定位，也可直接点击地图" value={address} onChange={(event) => { setAddress(event.target.value); setIsPositionConfirmed(false); resetResult(); }} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing || !address.trim()) return; event.preventDefault(); setLocateSignal((signal) => signal + 1); }} /></label>
          {isMapMounted && !isQuerying && !recommendation ? <ProjectLocationMap address={address} className="recommendation-location-map" initialPosition={position} locateSignal={locateSignal} onAddressChange={setAddress} onPositionChange={updatePosition} showCredit={false} showToolbar={false} usageLabel="检测位置" /> : null}
          {!recommendation && address.trim() && position && !isPositionConfirmed ? <p className="recommendation-location-warning" role="status">地址已修改，请按回车定位或在地图上重新选点，确认坐标后才能查询。</p> : null}
        </div>
        {isQuerying ? <RecommendationCalculationProgress activeStep={calculationProgressStep} /> : null}
        {recommendationError ? <div className="recommendation-weather-input recommendation-weather-input--error"><span>计算失败</span><strong>{recommendationError}</strong></div> : null}
        {!isQuerying && recommendation && position ? <div className="recommendation-results">
          <section className="recommendation-result-section" aria-labelledby="recommendation-result-title">
            <h3 className="recommendation-section-title" id="recommendation-result-title">检测结果</h3>
            <div className="recommendation-result-content">
              <div className={`recommendation-primary recommendation-primary--${recommendation.recommendationLevel === "优选时段" ? "preferred" : recommendation.recommendationLevel === "可用时段" ? "usable" : "unavailable"}`}>
                {recommendation.recommendationLevel !== "不推荐" ? <span>{recommendation.recommendationLevel}</span> : null}
                <strong>{recommendation.primaryWindow?.label ?? "无推荐时段"}</strong>
              </div>
              {recommendation.recommendationLevel === "优选时段" && recommendation.usableWindow ? <div className="recommendation-primary recommendation-primary--usable">
                <span>可用时段</span>
                <strong>{recommendation.usableWindow.label}</strong>
              </div> : null}
            </div>
          </section>
          <section className={`recommendation-calculation-section recommendation-calculation-section--collapsible${isCalculationDetailsExpanded ? " is-expanded" : ""}`} aria-labelledby="recommendation-calculation-title">
            <button
              aria-controls="recommendation-calculation-details"
              aria-expanded={isCalculationDetailsExpanded}
              className="recommendation-calculation-toggle"
              id="recommendation-calculation-title"
              type="button"
              onClick={() => setIsCalculationDetailsExpanded((isExpanded) => !isExpanded)}
            >
              <span className="recommendation-section-title">计算过程</span>
              <ChevronDown aria-hidden="true" />
            </button>
            {isCalculationDetailsExpanded ? <div className="recommendation-calculation" id="recommendation-calculation-details">
              <ol>
                {[
                  { title: "确定参与计算的时段", detail: recommendation.calculation.evaluationRange },
                  { title: "建立气温变化曲线", detail: recommendation.calculation.temperatureModel },
                  { title: "计算墙面太阳辐照", detail: `${orientation}向立面（方位角 ${orientationAzimuth[orientation]}°）；${recommendation.calculation.radiationModel}` },
                  { title: "计算风速散热影响", detail: recommendation.calculation.convectionModel },
                  { title: "判断正温差窗口", detail: recommendation.calculation.positiveJudgement },
                  { title: "判断负温差窗口", detail: recommendation.calculation.negativeJudgement }
                ].map((step, index) => (
                  <li className="is-complete" key={step.title}>
                    <span><Check aria-hidden="true" /></span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div> : null}
          </section>
        </div> : null}
      </div>
      {!isQuerying ? <div className={`dialog-actions${recommendation ? " dialog-actions--complete" : ""}`}>
          {recommendation
            ? <button className="button primary" type="button" onClick={requestDialogClose}>完成</button>
            : <>
                <button className="button secondary" type="button" onClick={requestDialogClose}>取消</button>
                <button className="button primary" disabled={!date || !position || !isPositionConfirmed} type="button" onClick={queryRecommendation}>查询推荐</button>
              </>}
        </div> : null}
    </dialog>
  );
}

function readableError(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "天气数据获取或推荐计算失败。";
}

export function CapabilityDetailPage() {
  const { type } = useParams();
  if (type && type in legacyDetailRoutes) return <Navigate replace to={`/capabilities/${legacyDetailRoutes[type]}`} />;
  if (!type || !(type in details)) return <Navigate replace to="/" />;
  return <DefectDetail key={type} detail={details[type as keyof typeof details]} />;
}
