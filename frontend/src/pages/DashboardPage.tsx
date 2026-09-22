import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ScanSearch,
  Sparkles
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { capabilityDescriptions } from "@/data/capabilityDescriptions";
import { HeroVideoPlaylist } from "@/components/HeroVideoPlaylist";
import { TimeRecommendationDialog } from "@/components/TimeRecommendationDialog";
import { usePublicHeroAnimation } from "@/hooks/usePublicHeroAnimation";

gsap.registerPlugin(ScrollTrigger);

type DefectCard = {
  key: string;
  title: string;
  description?: string;
  image?: string;
};

const defects: DefectCard[] = [
  {
    key: "crack",
    title: "裂缝识别",
    description: capabilityDescriptions.crack,
    image: "/images/optimized/defect-crack-card.webp"
  },
  {
    key: "spalling",
    title: "脱落识别",
    description: capabilityDescriptions.spalling,
    image: "/images/optimized/defect-spalling-card.webp"
  },
  {
    key: "hollow",
    title: "空鼓识别",
    description: capabilityDescriptions.hollow,
    image: "/images/optimized/defect-hollow-card.webp"
  },
  {
    key: "peeling",
    title: "起皮识别",
    description: capabilityDescriptions.peeling,
    image: "/images/optimized/defect-peeling-card.webp"
  },
  {
    key: "damage",
    title: "面板损坏识别",
    description: capabilityDescriptions.damage,
    image: "/images/optimized/defect-damage-card.webp"
  }
];

function DefectCardContent({ defect }: { defect: DefectCard }) {
  return (
    <>
      <div className={`defect-media${defect.image ? "" : " is-placeholder"}`}>
        {defect.image
          ? <img alt={`${defect.title}示意图`} decoding="async" loading="lazy" src={defect.image} />
          : <span className="defect-media-placeholder">图片待补充</span>}
      </div>
      <div className="defect-card-body">
        <div className="defect-card-copy">
          <h3>{defect.title}</h3>
          {defect.description ? <p>{defect.description}</p> : null}
        </div>
      </div>
    </>
  );
}

export function DashboardPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const defectSectionRef = useRef<HTMLElement>(null);
  const defectCarouselRef = useRef<HTMLDivElement>(null);
  const defectScrollEndTimerRef = useRef(0);
  const [activeDefectIndex, setActiveDefectIndex] = useState(0);
  const [isDefectSectionVisible, setIsDefectSectionVisible] = useState(false);
  const [isDefectAutoplayPaused, setIsDefectAutoplayPaused] = useState(false);
  const [isDefectAutoplayComplete, setIsDefectAutoplayComplete] = useState(false);
  const [timeRecommendationOpenSignal, setTimeRecommendationOpenSignal] = useState(0);
  usePublicHeroAnimation(heroRef, undefined, pageRef);

  const scrollToDefect = (index: number) => {
    const carousel = defectCarouselRef.current;
    const card = carousel?.children[index] as HTMLElement | undefined;
    if (!carousel || !card) return;

    setIsDefectAutoplayComplete(false);
    setActiveDefectIndex(index);
    carousel.scrollTo({
      left: card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  };

  const handleDefectCarouselScroll = () => {
    window.clearTimeout(defectScrollEndTimerRef.current);
    defectScrollEndTimerRef.current = window.setTimeout(() => {
      const carousel = defectCarouselRef.current;
      if (!carousel) return;

      const viewportCenter = carousel.scrollLeft + carousel.clientWidth / 2;
      const cards = Array.from(carousel.children) as HTMLElement[];
      const nearestIndex = cards.reduce((closestIndex, card, index) => (
        Math.abs(card.offsetLeft + card.offsetWidth / 2 - viewportCenter)
          < Math.abs(cards[closestIndex].offsetLeft + cards[closestIndex].offsetWidth / 2 - viewportCenter)
          ? index
          : closestIndex
      ), 0);
      if (nearestIndex !== defects.length - 1) setIsDefectAutoplayComplete(false);
      setActiveDefectIndex(nearestIndex);
    }, 120);
  };

  useEffect(() => {
    if (isDefectAutoplayPaused || isDefectAutoplayComplete || !isDefectSectionVisible) return undefined;

    const rotationTimer = window.setTimeout(() => {
      if (activeDefectIndex === defects.length - 1) {
        setIsDefectAutoplayComplete(true);
        return;
      }

      scrollToDefect(activeDefectIndex + 1);
    }, 4000);

    return () => window.clearTimeout(rotationTimer);
  }, [activeDefectIndex, isDefectAutoplayComplete, isDefectAutoplayPaused, isDefectSectionVisible]);

  const toggleDefectAutoplay = () => {
    if (isDefectAutoplayComplete) {
      setIsDefectAutoplayPaused(false);
      scrollToDefect(0);
      return;
    }

    setIsDefectAutoplayPaused((paused) => !paused);
  };

  useEffect(() => {
    const section = defectSectionRef.current;
    if (!section) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      setIsDefectSectionVisible(entry.isIntersecting && entry.intersectionRatio >= 0.6);
    }, { threshold: [0, 0.6] });

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    defects.forEach((defect) => {
      if (!defect.image) return;
      const image = new Image();
      image.src = defect.image;
    });

    return () => window.clearTimeout(defectScrollEndTimerRef.current);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;

    const panels = Array.from(page.querySelectorAll<HTMLElement>("[data-home-panel]"));
    if (panels.length === 0) return undefined;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const usesPanelScroll = window.matchMedia("(min-width: 861px)");
    let transitionLocked = false;
    let unlockTimer = 0;
    let transitionLockMinimum = 0;

    const panelScrollTop = (panel: HTMLElement) => Math.min(
      panel.offsetTop,
      Math.max(0, page.scrollHeight - page.clientHeight)
    );

    const currentPanelIndex = () => panels.reduce((closestIndex, panel, index) => (
      Math.abs(panelScrollTop(panel) - page.scrollTop) < Math.abs(panelScrollTop(panels[closestIndex]) - page.scrollTop)
        ? index
        : closestIndex
    ), 0);

    const updateHomeNavigation = () => {
      window.dispatchEvent(new CustomEvent<boolean>("home-navigation-visibility", {
        detail: (usesPanelScroll.matches ? page.scrollTop : window.scrollY) < Math.min(80, window.innerHeight * 0.1)
      }));
    };

    const goToPanel = (index: number) => {
      const target = panels[Math.max(0, Math.min(index, panels.length - 1))];
      if (!target) return;

      transitionLocked = true;
      transitionLockMinimum = performance.now() + (reduceMotion.matches ? 0 : 700);
      page.scrollTo({
        top: panelScrollTop(target),
        behavior: reduceMotion.matches ? "auto" : "smooth"
      });

      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(() => {
        transitionLocked = false;
      }, reduceMotion.matches ? 0 : 760);
    };

    const extendWheelGestureLock = () => {
      if (!transitionLocked) return;
      const delay = Math.max(160, transitionLockMinimum - performance.now());
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(() => {
        transitionLocked = false;
      }, delay);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!usesPanelScroll.matches) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || Math.abs(event.deltaY) < 6) return;

      event.preventDefault();
      if (transitionLocked) {
        extendWheelGestureLock();
        return;
      }

      const currentIndex = currentPanelIndex();
      const nextIndex = currentIndex + (event.deltaY > 0 ? 1 : -1);
      if (nextIndex === currentIndex || nextIndex < 0 || nextIndex >= panels.length) return;
      goToPanel(nextIndex);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!usesPanelScroll.matches) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, select, textarea, [contenteditable='true']")) return;

      const currentIndex = currentPanelIndex();
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") nextIndex = currentIndex + 1;
      if (event.key === "ArrowUp" || event.key === "PageUp") nextIndex = currentIndex - 1;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = panels.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      if (!transitionLocked) goToPanel(nextIndex);
    };

    const handleResize = () => {
      if (!usesPanelScroll.matches) {
        page.scrollTo({ top: 0, behavior: "auto" });
        updateHomeNavigation();
        return;
      }
      const currentIndex = currentPanelIndex();
      page.scrollTo({ top: panelScrollTop(panels[currentIndex]), behavior: "auto" });
      updateHomeNavigation();
    };

    page.addEventListener("wheel", handleWheel, { passive: false });
    page.addEventListener("scroll", updateHomeNavigation, { passive: true });
    window.addEventListener("scroll", updateHomeNavigation, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    updateHomeNavigation();

    return () => {
      window.clearTimeout(unlockTimer);
      page.removeEventListener("wheel", handleWheel);
      page.removeEventListener("scroll", updateHomeNavigation);
      window.removeEventListener("scroll", updateHomeNavigation);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.dispatchEvent(new CustomEvent<boolean>("home-navigation-visibility", { detail: true }));
    };
  }, []);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;
    const revealScroller = window.matchMedia("(min-width: 861px)").matches ? page : undefined;

    const context = gsap.context(() => {
      page.querySelectorAll<HTMLElement>(".home-reveal-section").forEach((section) => {
        section.querySelectorAll<HTMLElement>(".home-reveal-item").forEach((item, index) => {
          gsap.fromTo(
            item,
            { autoAlpha: 0, y: 60 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.8,
              delay: index * 0.12,
              ease: "power2.out",
              onComplete: () => gsap.set(item, { clearProps: "opacity,transform,visibility" }),
                scrollTrigger: {
                  ...(revealScroller ? { scroller: revealScroller } : {}),
                  trigger: item,
                start: "20% bottom",
                toggleActions: "play none none none"
              }
            }
          );
        });
      });
    }, page);

    return () => {
      context.revert();
    };
  }, []);

  return (
    <>
      <div ref={pageRef} className="home-page">
      <section ref={heroRef} className="hero" data-home-panel aria-labelledby="home-hero-title">
        <HeroVideoPlaylist />
        <div className="hero-copy">
          <h1 id="home-hero-title">发现问题，更早一步。</h1>
          <div className="hero-copy-footer">
            <p className="hero-description">
              我们采用最新的视觉分析技术，支持上传可见光与热成像照片，可准确、高效地评估建筑外墙状况
            </p>
            <div className="hero-actions">
              <div className="hero-primary-action">
                <Link className="button primary" to="/trials">
                  <Sparkles aria-hidden="true" />上传照片快速体验<ArrowRight className="hero-action-arrow" aria-hidden="true" />
                </Link>
              </div>
              <Link className="button secondary" to="/detections">
                <ScanSearch aria-hidden="true" />开始专业检测<ArrowRight className="hero-action-arrow" aria-hidden="true" />
              </Link>
              <button className="button secondary" type="button" onClick={() => setTimeRecommendationOpenSignal((signal) => signal + 1)}>
                <CalendarClock aria-hidden="true" />查询检测时段<ArrowRight className="hero-action-arrow" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section ref={defectSectionRef} className="section home-reveal-section" id="ai" data-home-panel aria-labelledby="home-ai-title">
        <div className="section-heading home-reveal-item">
          <h2 id="home-ai-title">检测能力</h2>
        </div>
        <div className="defect-carousel home-reveal-item" aria-label="检测能力轮播" aria-roledescription="轮播图">
          <div ref={defectCarouselRef} className="defect-carousel-track" onScroll={handleDefectCarouselScroll}>
            {defects.map((defect, index) => (
              <article key={defect.key} className={`defect-card defect-carousel-card${index === activeDefectIndex ? " is-active" : ""}`} id={`defect-${defect.key}`} aria-label={defect.title}>
                <DefectCardContent defect={defect} />
              </article>
            ))}
          </div>
          <div className="defect-carousel-control-row">
            <div className="defect-carousel-controls" aria-label="检测能力卡片切换" role="group">
              <button
                aria-label="上一项检测能力"
                disabled={activeDefectIndex === 0}
                type="button"
                onClick={() => scrollToDefect(activeDefectIndex - 1)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <div className="defect-carousel-pagination" aria-label="选择检测能力">
                {defects.map((defect, index) => (
                  <button
                    key={defect.key}
                    className={index === activeDefectIndex ? "is-active" : ""}
                    type="button"
                    aria-label={`显示${defect.title}`}
                    aria-current={index === activeDefectIndex ? "true" : undefined}
                    onClick={() => scrollToDefect(index)}
                  />
                ))}
              </div>
              <button
                aria-label="下一项检测能力"
                disabled={activeDefectIndex === defects.length - 1}
                type="button"
                onClick={() => scrollToDefect(activeDefectIndex + 1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <button
              className="defect-carousel-autoplay-toggle"
              aria-label={isDefectAutoplayComplete ? "重新播放自动轮播" : isDefectAutoplayPaused ? "开始自动轮播" : "暂停自动轮播"}
              aria-pressed={isDefectAutoplayPaused || isDefectAutoplayComplete}
              type="button"
              onClick={toggleDefectAutoplay}
            >
              {isDefectAutoplayComplete
                ? <img alt="" aria-hidden="true" decoding="async" src="/icons/replay.png" />
                : isDefectAutoplayPaused
                ? <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M5 2.5 21 12 5 21.5Z" fill="currentColor" /></svg>
                : <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M3.5 2.5h6v19h-6zM14.5 2.5h6v19h-6z" fill="currentColor" /></svg>}
            </button>
          </div>
        </div>
      </section>

      <footer className="home-contact-footer" id="contact" data-home-panel aria-label="联合研发单位及联系方式">
        <div className="home-contact-inner">
          <div className="home-contact-company">
            <div className="home-contact-company-name">
              <h2>联合研发单位</h2>
              <ul className="home-contact-organization-list">
                <li>
                  <img className="home-contact-organization-logo" decoding="async" loading="lazy" src="/images/国家.png" alt="" />
                  <strong>国家城市安全发展科技研究院</strong>
                </li>
                <li>
                  <img className="home-contact-organization-logo" decoding="async" loading="lazy" src="/images/深圳.png" alt="" />
                  <strong>深圳市公共城市安全研究院有限公司</strong>
                </li>
              </ul>
            </div>
          </div>

          <div className="home-contact-details">
            <h2 id="contact-title">联系我们</h2>
            <dl>
              <div>
                <dt>商务联系人</dt>
                <dd className="home-contact-person">
                  <span className="home-contact-person-name">邓鹏</span>
                  <span className="home-contact-number">13826521065</span>
                </dd>
              </div>
              <div>
                <dt>技术联系人</dt>
                <dd className="home-contact-person">
                  <span className="home-contact-person-name">陆伟庆</span>
                  <span className="home-contact-number">13556995290</span>
                </dd>
              </div>
              <div>
                <dt>座机号码</dt>
                <dd><span className="home-contact-number">0755-8812702</span></dd>
              </div>
              <div className="home-contact-address">
                <dt>地址</dt>
                <dd>深圳市罗湖区清水河街道清水河社区清水河三路18号博盈大厦（城安大厦实验楼）</dd>
              </div>
            </dl>
          </div>

          <div className="home-contact-bottom">
            <nav className="home-legal-links" aria-label="法律文件">
              <Link to="/privacy">隐私政策</Link>
              <Link to="/terms">用户服务协议</Link>
            </nav>
            <small className="home-contact-meta" aria-label="版权信息">
              <span>© 2026 国家城市安全发展科技研究院 版权所有</span>
            </small>
          </div>
        </div>
      </footer>
      </div>
      <TimeRecommendationDialog openSignal={timeRecommendationOpenSignal} />
    </>
  );
}
