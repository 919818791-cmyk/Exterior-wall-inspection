import {
  ChevronRight,
  FileCheck2,
  FileText,
  FolderPlus,
  ScanSearch,
  Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";

const defects = [
  { key: "crack", title: "裂缝识别", image: "/images/defects/defect-crack-hd.png" },
  { key: "missing", title: "面砖剥落识别", image: "/images/defects/defect-spalling-hd.png" },
  { key: "moisture", title: "潮湿识别", image: "/images/defects/defect-leakage-hd.png" },
  { key: "corrosion", title: "锈蚀识别", image: "/images/defects/defect-corrosion-hd.png" },
  { key: "hollow", title: "空鼓识别", image: "/images/defects/defect-hollow-hd.png" }
];

export function DashboardPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>
            <span className="hero-line">
              <span className="phrase">让检测<span className="accent">更智能</span>，</span>
              <span className="phrase">让报告<span className="accent">更高效</span></span>
            </span>
          </h1>
          <p className="hero-description">
            我们采用最新的AI 视觉分析技术，可对建筑物的外墙状况进行快速、准确且高效的评估
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/trial"><Sparkles aria-hidden="true" />立即检测</Link>
            <Link className="button secondary" to="/reports"><FileText aria-hidden="true" />查看示例</Link>
          </div>
        </div>
      </section>

      <section className="section" id="ai">
        <div className="section-heading">
          <h2>AI检测能力</h2>
          <p>
            <span className="section-subtitle-line">覆盖裂缝、面砖剥落、潮湿、锈蚀、空鼓五类高频外墙隐患，结合视觉分</span>
            <span className="section-subtitle-line">析快速定位问题，让风险发现更早、复核更准</span>
          </p>
        </div>
        <div className="defect-grid">
          {defects.map((defect) => (
            <Link key={defect.key} className="defect-card" id={`defect-${defect.key}`} to={`/capabilities/${defect.key}`} aria-label={`查看${defect.title}详情`}>
              <div className="defect-media"><img alt={`${defect.title}示意图`} src={defect.image} /></div>
              <div className="defect-card-body">
                <h3>{defect.title}</h3>
                <span className="defect-detail-link">了解详情 <ChevronRight aria-hidden="true" /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section compact" id="capabilities">
        <div className="section-heading">
          <h2>核心功能</h2>
          <p>
            <span className="section-subtitle-line">围绕采集前规划、检测中识别、交付后报告三大环节，打通外墙巡检</span>
            <span className="section-subtitle-line">关键流程，让项目推进更快、结果更清晰、管理更省心</span>
          </p>
        </div>
        <div className="capability-grid">
          <article className="capability-card time-recommendation-card">
            <span className="feature-icon feature-icon-image time-recommendation-mark">
              <img alt="" src="/images/capabilities/time-recommendation.png" />
            </span>
            <div>
              <h3>检测时段推荐</h3>
              <p>综合立面朝向、温度、风速和光照等因素，推荐适合采集的时段</p>
              <Link to="/capabilities/time">了解详情 <ChevronRight aria-hidden="true" /></Link>
            </div>
          </article>
          <article className="capability-card">
            <span className="feature-icon indigo"><ScanSearch aria-hidden="true" /></span>
            <div>
              <h3>AI缺陷识别</h3>
              <p>基于视觉分析算法，识别裂缝、面砖剥落、潮湿、锈蚀、空鼓等缺陷</p>
              <a href="#ai">了解详情 <ChevronRight aria-hidden="true" /></a>
            </div>
          </article>
          <article className="capability-card">
            <span className="feature-icon green"><FileCheck2 aria-hidden="true" /></span>
            <div>
              <h3>智能报告生成</h3>
              <p>系统汇总检测结果和标注图，生成在线检测报告并支持导出</p>
              <Link to="/reports">了解详情 <ChevronRight aria-hidden="true" /></Link>
            </div>
          </article>
        </div>
      </section>

      <section className="trial-section" id="trial">
        <div className="trial-card">
          <div className="trial-copy">
            <h2>上传图像，生成简易检测结果</h2>
            <p>从图像识别到结果归档，全流程在线完成，让建筑外墙巡检更简单、更高效。</p>
            <Link className="button primary" to="/trial"><FolderPlus aria-hidden="true" />开始智能检测</Link>
          </div>
          <div className="system-preview trial-image-preview" aria-label="AI检测示意图">
            <figure className="trial-detection-card trial-detection-card-main">
              <img alt="裂缝识别标注示意图" src="/images/trial/crack-material.png" />
              <figcaption><strong>裂缝识别</strong><span>裂缝位置标注</span></figcaption>
            </figure>
            <figure className="trial-detection-card trial-detection-card-secondary">
              <img alt="面砖剥落识别标注示意图" src="/images/defects/defect-spalling-hd.png" />
              <figcaption><strong>面砖剥落识别</strong><span>剥落区域定位</span></figcaption>
            </figure>
          </div>
        </div>
      </section>
    </>
  );
}
