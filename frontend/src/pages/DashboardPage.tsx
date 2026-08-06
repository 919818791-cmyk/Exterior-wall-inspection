import {
  ChevronRight,
  FileCheck2,
  FileText,
  ScanSearch,
  Sparkles
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { usePublicHeroAnimation } from "@/hooks/usePublicHeroAnimation";

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
  usePublicHeroAnimation(heroRef);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;

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
    <div ref={pageRef} className="home-page">
      <section ref={heroRef} className="hero">
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
          <div className="hero-copy-main">
            <h1>
              <span className="hero-line">
                <span className="phrase">让检测<span className="accent">更智能</span></span>
                <span className="phrase">让报告<span className="accent">更高效</span></span>
              </span>
            </h1>
            <p className="hero-description">
              我们采用最新的AI 视觉分析技术，可对建筑物的外墙状况进行快速、准确且高效的评估
            </p>
          </div>
          <div className="hero-actions">
            <div className="hero-primary-action">
              <Link className="button primary" to="/trial"><Sparkles aria-hidden="true" />上传照片开始体验</Link>
              <span className="hero-trial-note">* 限时赠送免费体验额度</span>
            </div>
            <Link className="button secondary" to="/reports"><FileText aria-hidden="true" />查看示例</Link>
          </div>
        </div>
      </section>

      <section className="section home-reveal-section" id="ai">
        <div className="section-heading home-reveal-item">
          <h2>AI检测能力</h2>
          <p>
            <span className="section-subtitle-line">覆盖裂缝、剥落、锈蚀、空鼓四类高频外墙隐患，结合视觉分析快速</span>
            <span className="section-subtitle-line">定位问题，让风险发现更早、复核更准</span>
          </p>
        </div>
        <div className="defect-grid">
          {defects.map((defect) => (
            <Link key={defect.key} className="defect-card home-reveal-item" id={`defect-${defect.key}`} to={`/capabilities/${defect.key}`} aria-label={`查看${defect.title}详情`}>
              <div className="defect-media"><img alt={`${defect.title}示意图`} decoding="async" loading="lazy" src={defect.image} /></div>
              <div className="defect-card-body">
                <h3>{defect.title}</h3>
                <p className="defect-description">{defect.description}</p>
                <span className="defect-detail-link">了解详情 <ChevronRight aria-hidden="true" /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section compact home-reveal-section" id="capabilities">
        <div className="section-heading home-reveal-item">
          <h2>核心功能</h2>
          <p>
            <span className="section-subtitle-line">围绕采集前规划、检测中识别、交付后报告三大环节</span>
          </p>
        </div>
        <div className="capability-grid">
          <Link className="capability-card time-recommendation-card home-reveal-item" to="/capabilities/time">
            <span className="feature-icon feature-icon-image time-recommendation-mark">
              <img alt="" decoding="async" loading="lazy" src="/images/optimized/time-recommendation-icon.webp" />
            </span>
            <div>
              <h3>检测时段推荐</h3>
              <p>综合立面朝向、温度和光照等因素，推荐适合采集的时段</p>
            </div>
          </Link>
          <Link className="capability-card home-reveal-item" to="/trial">
            <span className="feature-icon indigo"><ScanSearch aria-hidden="true" /></span>
            <div>
              <h3>AI缺陷识别</h3>
              <p>基于视觉分析算法，识别裂缝、剥落、锈蚀、空鼓等缺陷</p>
            </div>
          </Link>
          <Link className="capability-card home-reveal-item" to="/reports">
            <span className="feature-icon green"><FileCheck2 aria-hidden="true" /></span>
            <div>
              <h3>智能报告生成</h3>
              <p>系统汇总检测结果和标注图，生成在线检测报告并支持导出</p>
            </div>
          </Link>
        </div>
      </section>

      <footer className="home-contact-footer" id="contact" aria-label="联合研发单位及联系方式">
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
                <dt>技术联系人</dt>
                <dd className="home-contact-person">
                  <span className="home-contact-person-name">陆伟庆</span>
                  <span className="home-contact-number">13556995290</span>
                </dd>
              </div>
              <div>
                <dt>商务联系人</dt>
                <dd className="home-contact-person">
                  <span className="home-contact-person-name">邓鹏</span>
                  <span className="home-contact-number">13826521065</span>
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
  );
}
