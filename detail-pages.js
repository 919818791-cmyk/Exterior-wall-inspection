const defectDetails = {
  crack: {
    title: "裂缝检测",
    category: "外墙表观缺陷",
    summary: "自动识别建筑外墙线状、网状及分叉裂缝，记录位置、长度、走向和识别置信度，为工程复核提供清晰依据。",
    introTitle: "快速定位裂缝形态与延伸方向",
    lead: "系统对无人机采集的外墙影像进行分区分析，识别细微裂缝及连续裂缝区域，并将检测结果映射到对应立面位置。",
    facts: [
      ["识别对象", "线状裂缝、网状裂缝、分叉裂缝"],
      ["推荐影像", "高分辨率可见光影像"],
      ["重点结果", "位置、长度、走向、置信度"],
    ],
    process: [
      ["影像采集", "无人机按立面分区采集清晰、连续且重叠充分的外墙影像。"],
      ["AI定位", "模型识别裂缝边界与走向，并生成可复核的缺陷标注。"],
      ["工程复核", "工程师确认缺陷类型与风险等级后写入检测报告。"],
    ],
    outputs: ["裂缝位置与边界标注图", "裂缝长度、走向及置信度", "按立面和楼层整理的缺陷清单", "可直接纳入报告的复核结论"],
    caption: "高分辨率影像用于定位外墙裂缝及其分布位置",
  },
  spalling: {
    title: "剥落检测",
    category: "饰面层缺陷",
    summary: "识别饰面层、涂层及保护层的剥落区域，提取边界与面积信息，辅助判断潜在脱落风险。",
    introTitle: "识别剥落边界与潜在脱落区域",
    lead: "系统从外墙纹理、颜色和边缘变化中识别异常区域，将零散剥落与连续剥落分别标注，便于制定维修优先级。",
    facts: [
      ["识别对象", "饰面层、涂层、保护层剥落"],
      ["推荐影像", "正射与近距离可见光影像"],
      ["重点结果", "边界、面积、位置、风险提示"],
    ],
    process: [
      ["影像采集", "围绕建筑立面采集清晰纹理与构造细节，减少反光和遮挡。"],
      ["区域分割", "模型提取剥落区域的完整边界并计算其相对面积。"],
      ["风险复核", "结合所在高度、构件位置和面积判断处置优先级。"],
    ],
    outputs: ["剥落区域边界标注图", "缺陷面积与所在立面位置", "潜在脱落风险提示", "维修复核与报告记录"],
    caption: "通过立面纹理和边缘变化识别饰面层剥落区域",
  },
  hollow: {
    title: "空鼓检测",
    category: "隐蔽缺陷",
    summary: "结合红外热成像与可见光巡检影像，识别温差异常及疑似空鼓区域，为现场敲击复核和维修排查提供位置参考。",
    introTitle: "从热异常中筛查疑似空鼓区域",
    lead: "系统对立面红外影像进行温度分布分析，并结合构造边界与可见光影像排除明显干扰，输出需要优先复核的疑似空鼓区域。",
    facts: [
      ["识别对象", "温差异常与疑似空鼓区域"],
      ["推荐影像", "红外热成像与同步可见光影像"],
      ["重点结果", "异常位置、范围、温差与复核建议"],
    ],
    process: [
      ["窗口采集", "在适宜热成像时段采集连续红外影像与对应可见光影像。"],
      ["热异常识别", "模型分析温度分布并标记与周边差异明显的异常区域。"],
      ["现场复核", "工程师结合构造信息确定需要敲击或进一步检测的位置。"],
    ],
    outputs: ["疑似空鼓区域标注图", "热异常位置、范围与温差", "现场复核优先级建议", "红外与可见光对照记录"],
    caption: "红外热成像与可见光影像共同辅助空鼓区域复核",
  },
  leakage: {
    title: "渗漏检测",
    category: "水损与潮湿缺陷",
    summary: "识别水渍、泛碱、潮湿痕迹及连续污染带，定位疑似渗漏区域并记录其在外墙立面上的分布。",
    introTitle: "定位水渍、泛碱与潮湿异常",
    lead: "系统分析外墙颜色、纹理与水迹形态，区分局部污染和疑似渗漏痕迹，帮助工程师快速锁定需要排查的节点。",
    facts: [
      ["识别对象", "水渍、泛碱、潮湿痕迹"],
      ["推荐影像", "高分辨率可见光与红外影像"],
      ["重点结果", "位置、范围、形态与关联构造"],
    ],
    process: [
      ["影像采集", "重点覆盖窗边、接缝、屋面收口及排水构造等易渗节点。"],
      ["痕迹识别", "模型标记水迹与潮湿异常，并追踪其在立面上的连续分布。"],
      ["节点排查", "结合构造位置判断可能来源并形成现场复核清单。"],
    ],
    outputs: ["疑似渗漏区域标注图", "水迹范围与关联构造位置", "重点排查节点清单", "维修前后的对比依据"],
    caption: "立面影像用于追踪水迹、泛碱和潮湿区域的分布",
  },
  corrosion: {
    title: "锈蚀检测",
    category: "金属构件缺陷",
    summary: "识别金属构件锈斑、锈蚀扩散及伴随污染痕迹，记录缺陷范围并辅助评估构件耐久性。",
    introTitle: "识别锈斑范围与构件耐久风险",
    lead: "系统对金属构件和周边立面进行颜色与纹理分析，定位锈蚀区域及锈水流挂痕迹，便于持续跟踪缺陷变化。",
    facts: [
      ["识别对象", "锈斑、锈蚀扩散、锈水痕迹"],
      ["推荐影像", "近距离高分辨率可见光影像"],
      ["重点结果", "构件位置、范围、程度与趋势"],
    ],
    process: [
      ["构件采集", "重点拍摄金属连接件、幕墙节点、栏杆及外露钢构件。"],
      ["锈蚀识别", "模型区分锈斑与普通污染，标记锈蚀边界和扩散痕迹。"],
      ["耐久评估", "结合构件类型和缺陷范围形成复核与维护建议。"],
    ],
    outputs: ["锈蚀区域与构件位置标注", "缺陷范围和程度记录", "重点维护构件清单", "历次巡检对比基础数据"],
    caption: "近距离影像用于识别金属构件锈蚀及锈水痕迹",
  },
};

const detailRoot = document.querySelector("#detail-content");
const defectKey = document.body.dataset.defect;
const detail = defectDetails[defectKey];

if (detailRoot && detail) {
  document.title = `${detail.title} - 建筑外墙巡检智能报告平台`;

  detailRoot.innerHTML = `
    <section class="detail-hero">
      <div class="detail-hero-copy">
        <h1>${detail.title}</h1>
        <p>${detail.summary}</p>
        <div class="detail-actions">
          <a class="button primary" href="new-project.html">
            <i data-lucide="folder-plus" aria-hidden="true"></i>
            开始智能检测
          </a>
          <a class="button secondary" href="示例报告.pdf" data-report-preview data-report-title="${detail.title}示例" data-report-subtitle="建筑外墙巡检智能报告 · ${detail.title}">
            <i data-lucide="file-search" aria-hidden="true"></i>
            查看检测示例
          </a>
        </div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-intro">
        <div>
          <h2>${detail.introTitle}</h2>
          <p class="detail-lead">${detail.lead}</p>
        </div>
        <div class="detail-facts">
          ${detail.facts.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
        </div>
      </div>
    </section>

    <section class="detail-process-band">
      <div class="detail-section-inner">
        <h2>从影像采集到工程复核</h2>
        <div class="detail-process-grid">
          ${detail.process.map(([title, text], index) => `
            <article>
              <span class="process-number">0${index + 1}</span>
              <h3>${title}</h3>
              <p>${text}</p>
            </article>
          `).join("")}
        </div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-deliverable">
        <div>
          <h2>结果可复核、可追踪、可入报告</h2>
          <ul class="detail-check-list">
            ${detail.outputs.map((item) => `<li><i data-lucide="circle-check" aria-hidden="true"></i><span>${item}</span></li>`).join("")}
          </ul>
        </div>
        <figure class="detail-media">
          <img src="首页背景图.png" alt="无人机建筑外墙巡检现场" />
          <figcaption>${detail.caption}</figcaption>
        </figure>
      </div>
    </section>
  `;

  const currentLink = document.querySelector(`.nav-submenu a[href="${location.pathname.split("/").pop()}"]`);
  currentLink?.setAttribute("aria-current", "page");
}
