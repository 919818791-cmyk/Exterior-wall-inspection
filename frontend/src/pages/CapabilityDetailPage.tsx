import { CalendarPlus, CircleCheck, TriangleAlert, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

const details = {
  crack: {
    title: "裂缝识别", summary: "自动识别建筑外墙线状、网状及分叉裂缝，记录位置、长度、走向和识别置信度，为工程复核提供清晰依据。",
    intro: "快速定位裂缝形态与延伸方向", lead: "系统对无人机采集的外墙影像进行分区分析，识别细微裂缝及连续裂缝区域，并将检测结果映射到对应立面位置。",
    facts: [["识别对象", "线状裂缝、网状裂缝、分叉裂缝"], ["重点结果", "位置、长度、走向、置信度"]],
    image: "/images/defects/crack.jpg"
  },
  spalling: {
    title: "剥落识别", summary: "识别饰面层、涂层及保护层的剥落区域，提取边界与面积信息，辅助判断潜在脱落风险。",
    intro: "识别剥落边界与潜在脱落区域", lead: "系统从外墙纹理、颜色和边缘变化中识别异常区域，将零散剥落与连续剥落分别标注，便于制定维修优先级。",
    facts: [["识别对象", "饰面层、涂层、保护层剥落"], ["重点结果", "边界、面积、位置、风险提示"]],
    image: "/images/defects/spalling.png"
  },
  hollow: {
    title: "空鼓识别", summary: "结合红外热成像与可见光巡检影像，识别温差异常及疑似空鼓区域，为现场敲击复核和维修排查提供位置参考。",
    intro: "从热异常中筛查疑似空鼓区域", lead: "系统对立面红外影像进行温度分布分析，并结合构造边界与可见光影像排除明显干扰，输出需要优先复核的疑似空鼓区域。",
    facts: [["识别对象", "温差异常与疑似空鼓区域"], ["重点结果", "异常位置、范围、温差与复核建议"]],
    image: "/images/defects/hollow.JPG"
  },
  leakage: {
    title: "渗漏识别", summary: "识别水渍、泛碱、潮湿痕迹及连续污染带，定位疑似渗漏区域并记录其在外墙立面上的分布。",
    intro: "定位水渍、泛碱与潮湿异常", lead: "系统分析外墙颜色、纹理与水迹形态，区分局部污染和疑似渗漏痕迹，帮助工程师快速锁定需要排查的节点。",
    facts: [["识别对象", "水渍、泛碱、潮湿痕迹"], ["重点结果", "位置、范围、形态与关联构造"]],
    image: "/images/defects/leakage.jpg"
  },
  corrosion: {
    title: "锈蚀识别", summary: "识别金属构件锈斑、锈蚀扩散及伴随污染痕迹，记录缺陷范围并辅助评估构件耐久性。",
    intro: "识别锈斑范围与构件耐久风险", lead: "系统对金属构件和周边立面进行颜色与纹理分析，定位锈蚀区域及锈水流挂痕迹，便于持续跟踪缺陷变化。",
    facts: [["识别对象", "锈斑、锈蚀扩散、锈水痕迹"], ["重点结果", "构件位置、范围、程度与趋势"]],
    image: "/images/defects/corrosion.jpg"
  }
} as const;

function DefectDetail({ detail }: { detail: (typeof details)[keyof typeof details] }) {
  return <>
    <section className="detail-hero defect-detail-hero" style={{ "--detail-hero-image": `url("${detail.image}")` } as CSSProperties}><div className="detail-hero-copy"><h1>{detail.title}</h1></div></section>
    <section className="detail-section"><div className="detail-intro"><div><h2>{detail.intro}</h2><p className="detail-lead">{detail.lead}</p></div><div className="detail-facts">{detail.facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div></section>
  </>;
}

const orientationWindows = {
  东: { primary: "07:30–09:00", backup: "16:00–17:00", summary: "上午低角度光线更稳定，适合东向立面连续采集" },
  南: { primary: "09:30–11:00", backup: "14:30–16:00", summary: "避开正午强反光，优先选择光照更均匀的过渡时段" },
  西: { primary: "15:30–17:00", backup: "08:00–09:00", summary: "下午光照条件更适合西向立面，风速风险较低" },
  北: { primary: "10:00–11:30", backup: "14:00–15:30", summary: "北向立面直射影响较小，可在温差稳定后采集" },
  东南: { primary: "08:00–10:00", backup: "15:30–16:30", summary: "上午光照稳定，适合东南向主立面采集" },
  东北: { primary: "08:30–10:00", backup: "14:00–15:30", summary: "上午反光较弱，可减少可见光照片过曝风险" },
  西南: { primary: "15:00–16:30", backup: "09:00–10:30", summary: "下午光线角度更合适，适合西南向立面补采" },
  西北: { primary: "14:30–16:00", backup: "10:00–11:00", summary: "午后光照更均匀，适合西北向立面巡检" }
} as const;

type Orientation = keyof typeof orientationWindows;

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function TimeRecommendation() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [orientation, setOrientation] = useState<Orientation>("东");
  const [hasResult, setHasResult] = useState(false);
  const window = orientationWindows[orientation];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDialogOpen && !dialog.open) dialog.showModal();
    if (!isDialogOpen && dialog.open) dialog.close();
  }, [isDialogOpen]);

  function openDialog() {
    setDate(today());
    setHasResult(false);
    setIsDialogOpen(true);
  }

  function resetResult() {
    setHasResult(false);
  }

  function queryRecommendation() {
    if (!date) return;
    setHasResult(true);
  }

  return <>
    <section className="detail-hero recommendation-hero"><div className="detail-hero-copy"><h1>检测时段推荐</h1><p>综合计划时间、立面朝向与气象条件，提前筛选更稳定、更安全的无人机采集窗口。</p><div className="detail-actions"><button className="button primary" type="button" onClick={openDialog}><CalendarPlus aria-hidden="true" />查询推荐时段</button></div></div></section>
    <section className="detail-section"><div className="detail-intro"><div><h2>让每次采集从合适的时间开始</h2><p className="detail-lead">系统结合计划时间、立面朝向和逐小时环境条件，对候选时段进行分级，减少强反光、温差不足与大风对采集质量的影响。</p></div><div className="detail-facts"><div><span>判断维度</span><strong>朝向、温度、风速风向、太阳辐照</strong></div><div><span>推荐结果</span><strong>优选时段、可用时段与风险提示</strong></div><div><span>适用任务</span><strong>可见光巡检、红外热成像、复飞补采</strong></div></div></div></section>
    <section className="detail-process-band"><div className="detail-section-inner"><h2>三步生成采集计划</h2><div className="detail-process-grid"><article><span className="process-number">01</span><h3>选择计算条件</h3><p>点击查询推荐时段，选择计划时间与立面朝向，明确本次推荐目标。</p></article><article><span className="process-number">02</span><h3>分析环境条件</h3><p>逐小时评估光照、温度、风速与风向，识别影响飞行和成像的风险。</p></article><article><span className="process-number">03</span><h3>输出作业窗口</h3><p>按推荐等级列出适合作业的时间段，并附上对应立面与注意事项。</p></article></div></div></section>
    <section className="detail-section" id="recommendation-example"><div className="recommendation-example"><div className="recommendation-copy"><h2>深圳南山区 · 东南立面</h2><p className="detail-lead">2026 年 6 月 19 日，可见光外墙巡检。上午光照稳定、风速较低，优先安排主要立面采集。</p><ul className="detail-check-list"><li><CircleCheck aria-hidden="true" /><span>08:00–10:00 为优选窗口，适合连续航线采集</span></li><li><CircleCheck aria-hidden="true" /><span>14:30–16:00 可用于北立面复飞与补采</span></li><li><TriangleAlert aria-hidden="true" /><span>11:00 后东南立面反光增强，建议避开正午时段</span></li></ul></div><div className="schedule-panel" aria-label="推荐时段示例"><div className="schedule-panel-head"><span>时段</span><span>综合条件</span><span>建议</span></div><div className="schedule-row best"><strong>08:00–10:00</strong><span>风速 2.1 m/s · 光照稳定</span><em>优选</em></div><div className="schedule-row"><strong>10:00–11:00</strong><span>反光逐步增强</span><em>可用</em></div><div className="schedule-row risk"><strong>11:00–14:30</strong><span>强光 · 地表升温</span><em>避开</em></div><div className="schedule-row"><strong>14:30–16:00</strong><span>北立面光照均匀</span><em>可用</em></div></div></div></section>
    <dialog ref={dialogRef} aria-labelledby="time-recommendation-title" className="project-dialog recommendation-dialog detection-time-dialog" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onClose={() => setIsDialogOpen(false)}>
      <div className="dialog-heading"><h2 id="time-recommendation-title">检测时段推荐</h2><button aria-label="关闭检测时段推荐" className="icon-button" type="button" onClick={() => dialogRef.current?.close()}><X aria-hidden="true" /></button></div>
      <div className="recommendation-content">
        <div className="recommendation-form-grid recommendation-form-grid--without-project">
          <label className="recommendation-date-field"><span>日期</span><input aria-label="选择日期" type="date" value={date} onChange={(event) => { setDate(event.target.value); resetResult(); }} /></label>
          <label className="recommendation-date-field"><span>立面朝向</span><select aria-label="选择立面朝向" value={orientation} onChange={(event) => { setOrientation(event.target.value as Orientation); resetResult(); }}>{(Object.keys(orientationWindows) as Orientation[]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        {hasResult ? <div className="recommendation-results"><div className="recommendation-primary"><span>最佳采集时段</span><strong>{window.primary}</strong><small>{date} · {window.summary}</small></div></div> : null}
      </div>
      <div className="dialog-actions"><button className="button secondary" type="button" onClick={() => dialogRef.current?.close()}>取消</button><button className="button primary" disabled={!date} type="button" onClick={queryRecommendation}>{hasResult ? "重新查询" : "查询推荐"}</button></div>
    </dialog>
  </>;
}

export function CapabilityDetailPage() {
  const { type } = useParams();
  if (type === "time") return <TimeRecommendation />;
  if (!type || !(type in details)) return <Navigate replace to="/" />;
  return <DefectDetail detail={details[type as keyof typeof details]} />;
}
