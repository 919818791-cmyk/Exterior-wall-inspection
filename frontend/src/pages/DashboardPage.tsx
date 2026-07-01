import {
  CalendarClock,
  ChevronRight,
  FileCheck2,
  FileText,
  FolderPlus,
  ScanSearch,
  Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";

const defects = [
  { key: "crack", title: "裂缝检测", description: "自动识别外墙线状裂缝，标注位置、长度及走向。", image: "/images/defects/defect-crack-hd.png" },
  { key: "spalling", title: "剥落检测", description: "识别饰面层、涂层等剥落区域，评估脱落风险。", image: "/images/defects/defect-spalling-hd.png" },
  { key: "hollow", title: "空鼓检测", description: "识别疑似空鼓相关区域，为现场确认提供参考。", image: "/images/defects/defect-hollow-hd.png" },
  { key: "leakage", title: "渗漏检测", description: "识别水渍、泛碱、潮湿痕迹等疑似渗漏区域。", image: "/images/defects/defect-leakage-hd.png" },
  { key: "corrosion", title: "锈蚀检测", description: "识别金属构件锈蚀及锈斑区域，辅助评估耐久性。", image: "/images/defects/defect-corrosion-hd.png" }
];

export function DashboardPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>
            <span className="hero-line">人工智能赋能的建筑外墙检查</span>
            <span className="hero-line">
              <span className="phrase">让检测<span className="accent">更智能</span>，</span>
              <span className="phrase">让报告<span className="accent">更高效</span></span>
            </span>
          </h1>
          <p className="hero-description">
            我们的建筑检查技术采用最新的人工智能技术和无人机，可对您的建筑物状况进行快速、准确且高效的评估。
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/trial"><Sparkles aria-hidden="true" />立即试用</Link>
            <Link className="button secondary" to="/reports"><FileText aria-hidden="true" />查看示例报告</Link>
          </div>
        </div>
      </section>

      <section className="section compact" id="capabilities">
        <div className="section-heading">
          <h2>核心能力</h2>
          <p>覆盖采集前、识别中、交付后三个关键环节</p>
        </div>
        <div className="capability-grid">
          <article className="capability-card">
            <span className="feature-icon blue"><CalendarClock aria-hidden="true" /></span>
            <div>
              <h3>检测时段推荐</h3>
              <p>综合用户选择的立面朝向、环境温度、风速风向和太阳辐照强度等因素，智能推荐适合无人机采集的作业窗口。</p>
              <Link to="/capabilities/time">了解详情 <ChevronRight aria-hidden="true" /></Link>
            </div>
          </article>
          <article className="capability-card">
            <span className="feature-icon indigo"><ScanSearch aria-hidden="true" /></span>
            <div>
              <h3>AI缺陷识别</h3>
              <p>基于视觉分析算法，自动识别裂缝、剥落、疑似空鼓、渗漏、锈蚀等外墙常见缺陷，输出缺陷标注图、类型和位置。</p>
              <a href="#ai">了解详情 <ChevronRight aria-hidden="true" /></a>
            </div>
          </article>
          <article className="capability-card">
            <span className="feature-icon green"><FileCheck2 aria-hidden="true" /></span>
            <div>
              <h3>智能报告生成</h3>
              <p>系统汇总缺陷位置、标注图、统计结果和复核结论，生成在线检测结果，并支持 PDF 导出与项目归档。</p>
              <Link to="/reports">了解详情 <ChevronRight aria-hidden="true" /></Link>
            </div>
          </article>
        </div>
      </section>

      <section className="section" id="ai">
        <div className="section-heading">
          <h2>AI检测能力</h2>
          <p>五大缺陷智能识别，覆盖建筑外墙常见隐患</p>
        </div>
        <div className="defect-grid">
          {defects.map((defect) => (
            <article key={defect.key} className="defect-card" id={`defect-${defect.key}`}>
              <div className="defect-media"><img alt={`${defect.title}示意图`} src={defect.image} /></div>
              <div className="defect-card-body">
                <h3>{defect.title}</h3>
                <p>{defect.description}</p>
                <Link to={`/capabilities/${defect.key}`}>了解详情</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="trial-section" id="trial">
        <div className="trial-card">
          <div className="trial-copy">
            <h2>上传图像，体验AI智能检测</h2>
            <p>从图像识别到报告生成，全流程在线体验，让建筑外墙巡检更简单、更高效。</p>
            <Link className="button primary" to="/trial"><FolderPlus aria-hidden="true" />开始智能检测</Link>
          </div>
          <div className="system-preview" aria-label="系统界面预览">
            <div className="preview-window projects">
              <div className="preview-bar" />
              <div className="preview-row active"><span /><strong>保利花园-A栋</strong><em>生成中</em></div>
              <div className="preview-row"><span /><strong>东南立面</strong><em>249项</em></div>
              <div className="preview-row"><span /><strong>复核工作台</strong><em>待处理</em></div>
            </div>
            <div className="preview-window image-panel"><div className="mini-facade" /><div className="mini-label">AI标注图</div></div>
            <div className="preview-window report"><div className="report-cover" /><h3>外墙巡检检测结果</h3><p>PDF 已生成 · 可导出</p><div className="bars"><span /><span /><span /></div></div>
          </div>
        </div>
      </section>
    </>
  );
}
