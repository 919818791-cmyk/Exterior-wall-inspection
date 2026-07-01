import { CalendarPlus, CircleCheck, FolderPlus, TriangleAlert, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

const details = {
  crack: {
    title: "裂缝检测", summary: "自动识别建筑外墙线状、网状及分叉裂缝，记录位置、长度、走向和识别置信度，为工程复核提供清晰依据。",
    intro: "快速定位裂缝形态与延伸方向", lead: "系统对无人机采集的外墙影像进行分区分析，识别细微裂缝及连续裂缝区域，并将检测结果映射到对应立面位置。",
    facts: [["识别对象", "线状裂缝、网状裂缝、分叉裂缝"], ["推荐影像", "高分辨率可见光影像"], ["重点结果", "位置、长度、走向、置信度"]],
    process: [["影像采集", "无人机按立面分区采集清晰、连续且重叠充分的外墙影像。"], ["AI定位", "模型识别裂缝边界与走向，并生成可复核的缺陷标注。"], ["工程复核", "工程师确认缺陷类型与风险等级后写入检测结果。"]],
    outputs: ["裂缝位置与边界标注图", "裂缝长度、走向及置信度", "按立面和楼层整理的缺陷清单", "可直接纳入报告的复核结论"], image: "/images/defects/crack.jpg", caption: "高分辨率影像用于定位外墙裂缝及其分布位置"
  },
  spalling: {
    title: "剥落检测", summary: "识别饰面层、涂层及保护层的剥落区域，提取边界与面积信息，辅助判断潜在脱落风险。",
    intro: "识别剥落边界与潜在脱落区域", lead: "系统从外墙纹理、颜色和边缘变化中识别异常区域，将零散剥落与连续剥落分别标注，便于制定维修优先级。",
    facts: [["识别对象", "饰面层、涂层、保护层剥落"], ["推荐影像", "正射与近距离可见光影像"], ["重点结果", "边界、面积、位置、风险提示"]],
    process: [["影像采集", "围绕建筑立面采集清晰纹理与构造细节，减少反光和遮挡。"], ["区域分割", "模型提取剥落区域的完整边界并计算其相对面积。"], ["风险复核", "结合所在高度、构件位置和面积判断处置优先级。"]],
    outputs: ["剥落区域边界标注图", "缺陷面积与所在立面位置", "潜在脱落风险提示", "维修复核与报告记录"], image: "/images/defects/spalling.png", caption: "通过立面纹理和边缘变化识别饰面层剥落区域"
  },
  hollow: {
    title: "空鼓检测", summary: "结合红外热成像与可见光巡检影像，识别温差异常及疑似空鼓区域，为现场敲击复核和维修排查提供位置参考。",
    intro: "从热异常中筛查疑似空鼓区域", lead: "系统对立面红外影像进行温度分布分析，并结合构造边界与可见光影像排除明显干扰，输出需要优先复核的疑似空鼓区域。",
    facts: [["识别对象", "温差异常与疑似空鼓区域"], ["推荐影像", "红外热成像与同步可见光影像"], ["重点结果", "异常位置、范围、温差与复核建议"]],
    process: [["窗口采集", "在适宜热成像时段采集连续红外影像与对应可见光影像。"], ["热异常识别", "模型分析温度分布并标记与周边差异明显的异常区域。"], ["现场复核", "工程师结合构造信息确定需要敲击或进一步检测的位置。"]],
    outputs: ["疑似空鼓区域标注图", "热异常位置、范围与温差", "现场复核优先级建议", "红外与可见光对照记录"], image: "/images/defects/hollow.JPG", caption: "红外热成像与可见光影像共同辅助空鼓区域复核"
  },
  leakage: {
    title: "渗漏检测", summary: "识别水渍、泛碱、潮湿痕迹及连续污染带，定位疑似渗漏区域并记录其在外墙立面上的分布。",
    intro: "定位水渍、泛碱与潮湿异常", lead: "系统分析外墙颜色、纹理与水迹形态，区分局部污染和疑似渗漏痕迹，帮助工程师快速锁定需要排查的节点。",
    facts: [["识别对象", "水渍、泛碱、潮湿痕迹"], ["推荐影像", "高分辨率可见光与红外影像"], ["重点结果", "位置、范围、形态与关联构造"]],
    process: [["影像采集", "重点覆盖窗边、接缝、屋面收口及排水构造等易渗节点。"], ["痕迹识别", "模型标记水迹与潮湿异常，并追踪其在立面上的连续分布。"], ["节点排查", "结合构造位置判断可能来源并形成现场复核清单。"]],
    outputs: ["疑似渗漏区域标注图", "水迹范围与关联构造位置", "重点排查节点清单", "维修前后的对比依据"], image: "/images/defects/leakage.jpg", caption: "立面影像用于追踪水迹、泛碱和潮湿区域的分布"
  },
  corrosion: {
    title: "锈蚀检测", summary: "识别金属构件锈斑、锈蚀扩散及伴随污染痕迹，记录缺陷范围并辅助评估构件耐久性。",
    intro: "识别锈斑范围与构件耐久风险", lead: "系统对金属构件和周边立面进行颜色与纹理分析，定位锈蚀区域及锈水流挂痕迹，便于持续跟踪缺陷变化。",
    facts: [["识别对象", "锈斑、锈蚀扩散、锈水痕迹"], ["推荐影像", "近距离高分辨率可见光影像"], ["重点结果", "构件位置、范围、程度与趋势"]],
    process: [["构件采集", "重点拍摄金属连接件、幕墙节点、栏杆及外露钢构件。"], ["锈蚀识别", "模型区分锈斑与普通污染，标记锈蚀边界和扩散痕迹。"], ["耐久评估", "结合构件类型和缺陷范围形成复核与维护建议。"]],
    outputs: ["锈蚀区域与构件位置标注", "缺陷范围和程度记录", "重点维护构件清单", "历次巡检对比基础数据"], image: "/images/defects/corrosion.jpg", caption: "近距离影像用于识别金属构件锈蚀及锈水痕迹"
  }
} as const;

function DefectDetail({ detail }: { detail: (typeof details)[keyof typeof details] }) {
  const isDetectionAvailable = detail.title === "裂缝检测" || detail.title === "剥落检测" || detail.title === "空鼓检测";
  const isComingSoon = detail.title === "渗漏检测" || detail.title === "锈蚀检测";

  return <>
    <section className="detail-hero" style={{ "--detail-hero-image": `url("${detail.image}")` } as CSSProperties}><div className="detail-hero-copy"><h1>{detail.title}</h1><p>{detail.summary}</p><div className="detail-actions">{isDetectionAvailable ? <Link className="button primary" to="/trial"><FolderPlus aria-hidden="true" />开始检测</Link> : isComingSoon ? <button className="button primary" disabled type="button"><FolderPlus aria-hidden="true" />敬请期待</button> : null}</div></div></section>
    <section className="detail-section"><div className="detail-intro"><div><h2>{detail.intro}</h2><p className="detail-lead">{detail.lead}</p></div><div className="detail-facts">{detail.facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div></section>
    <section className="detail-process-band"><div className="detail-section-inner"><h2>从影像采集到工程复核</h2><div className="detail-process-grid">{detail.process.map(([title, text], index) => <article key={title}><span className="process-number">0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="detail-section"><div className="detail-deliverable"><div><h2>结果可复核、可追踪、可入报告</h2><ul className="detail-check-list">{detail.outputs.map((item) => <li key={item}><CircleCheck aria-hidden="true" /><span>{item}</span></li>)}</ul></div><figure className="detail-media"><img alt={`${detail.title}示例`} src={detail.image} /><figcaption>{detail.caption}</figcaption></figure></div></section>
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
