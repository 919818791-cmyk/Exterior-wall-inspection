import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  FileCheck2,
  ScanSearch,
  Sparkles
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { usePublicHeroAnimation } from "@/hooks/usePublicHeroAnimation";
import { TimeRecommendationDialog } from "@/pages/CapabilityDetailPage";

gsap.registerPlugin(ScrollTrigger);

const defects = [
  {
    key: "crack",
    title: "裂缝识别",
    description: "识别墙面细微裂缝与延伸走向，辅助快速判断风险位置。",
    image: "/images/optimized/defect-crack-card.webp"
  },
  {
    key: "spalling",
    title: "剥落识别",
    description: "定位饰面层空缺与脱落区域，降低高空坠物安全隐患。",
    image: "/images/optimized/defect-spalling-card.webp"
  },
  {
    key: "corrosion",
    title: "锈蚀识别",
    description: "发现外露金属构件锈蚀迹象，辅助评估腐蚀范围与程度。",
    image: "/images/optimized/defect-corrosion-card.webp"
  },
  {
    key: "hollow",
    title: "空鼓识别",
    description: "结合热成像异常区域识别潜在空鼓，提升隐蔽缺陷筛查效率。",
    image: "/images/optimized/defect-hollow-card.webp"
  }
];

export function DashboardPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [timeRecommendationOpenSignal, setTimeRecommendationOpenSignal] = useState(0);
  usePublicHeroAnimation(heroRef, undefined, pageRef);

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
        <video
          className="hero-background-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        >
          <source src="/videos/MZ.mp4" type="video/mp4" />
        </video>
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

      <section className="section home-reveal-section" id="ai" data-home-panel aria-labelledby="home-ai-title">
        <div className="section-heading home-reveal-item">
          <h2 id="home-ai-title">检测能力</h2>
        </div>
        <div className="defect-grid">
          {defects.map((defect) => (
            <Link key={defect.key} className="defect-card home-reveal-item" id={`defect-${defect.key}`} to={`/capabilities/${defect.key}`} aria-label={`查看${defect.title}详情`}>
              <div className="defect-media"><img alt={`${defect.title}示意图`} decoding="async" loading="lazy" src={defect.image} /></div>
              <div className="defect-card-body">
                <div className="defect-card-copy">
                  <h3>{defect.title}</h3>
                  <p className="defect-description">{defect.description}</p>
                </div>
                <span className="defect-detail-link">了解详情 <ChevronRight aria-hidden="true" /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section compact home-reveal-section" id="capabilities" data-home-panel aria-labelledby="home-capabilities-title">
        <div className="section-heading home-reveal-item">
          <h2 id="home-capabilities-title">核心功能</h2>
        </div>
        <div className="capability-grid">
          <article className="capability-card time-recommendation-card home-reveal-item">
            <span className="feature-icon feature-icon-image time-recommendation-mark">
              <img alt="" decoding="async" loading="lazy" src="/images/optimized/time-recommendation-icon.webp" />
            </span>
            <div>
              <h3>检测时段推荐</h3>
              <p>综合立面朝向、温度和光照等因素，推荐适合采集的时段</p>
            </div>
          </article>
          <Link className="capability-card home-reveal-item" to="/trials/new">
            <span className="feature-icon indigo"><ScanSearch aria-hidden="true" /></span>
            <div>
              <h3>外墙缺陷识别</h3>
              <p>基于视觉分析算法，识别裂缝、剥落、锈蚀、空鼓等缺陷</p>
            </div>
          </Link>
          <Link className="capability-card home-reveal-item" to="/trials">
            <span className="feature-icon green"><FileCheck2 aria-hidden="true" /></span>
            <div>
              <h3>智能报告生成</h3>
              <p>系统汇总检测结果和标注图，生成在线检测报告并支持导出</p>
            </div>
          </Link>
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
