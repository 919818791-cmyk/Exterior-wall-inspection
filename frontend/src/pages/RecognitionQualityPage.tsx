import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { exportQuality, qualityCatalogOptions, qualityDetailOptions } from "@/api/recognitionQuality";
import type { QualityBox, QualityMatch, QualityMetrics, QualityPhoto } from "@/types/recognitionQuality";
import { saveBlobAsFile } from "@/utils/download";
import { formatDateTime } from "@/utils/projectDisplay";

const categories: Record<string, string> = { crack: "裂缝", spalling: "脱落", peeling: "起皮", damage: "面板破损", hollow: "空鼓" };
const kinds = { tp: "正确识别", fp: "误检", fn: "漏检" };
const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink";
const cell = "whitespace-nowrap border-b border-slate-100 px-4 py-3 text-left text-sm";
const percent = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(2)}%`;
const score = (value: number | null | undefined) => value == null ? "—" : value.toFixed(2);
const message = (error: unknown) => error instanceof Error ? error.message : "加载失败，请重试。";

function Metrics({ value }: { value: QualityMetrics }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="识别质量指标">
    {[["识别准确率", percent(value.precision), `正确 ${value.tp} · 误检 ${value.fp}`],
      ["召回率", percent(value.recall), `正确 ${value.tp} · 漏检 ${value.fn}`],
      ["综合评分", score(value.score), "F1 × 100，满分 100 分"],
      ["平均匹配 IoU", percent(value.mean_iou == null ? null : value.mean_iou * 100), "仅统计正确匹配的框"]].map(([label, amount, detail]) =>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" key={label}>
        <p className="text-sm text-slate-500">{label}</p><p className="my-2 text-2xl font-semibold text-ink">{amount}</p>
        <p className="text-xs text-slate-500">{detail}</p>
      </div>)}
  </div>;
}

function CategoryTable({ values }: { values: Record<string, QualityMetrics> }) {
  return <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200">
    <table className="w-full" aria-label="按缺陷类别的识别质量"><thead className="bg-slate-50"><tr>
      {["缺陷类别", "正确", "误检", "漏检", "准确率", "召回率", "评分"].map(title => <th className={cell} key={title} scope="col">{title}</th>)}
    </tr></thead><tbody>{Object.entries(values).map(([category, m]) => <tr key={category}>
      {[categories[category] ?? category, m.tp, m.fp, m.fn, percent(m.precision), percent(m.recall), score(m.score)].map((v, i) => <td className={cell} key={i}>{v}</td>)}
    </tr>)}</tbody></table>
    {!Object.keys(values).length ? <p className="p-5 text-sm text-slate-500">暂无已评估的缺陷类别。</p> : null}
  </div>;
}

function ExportButton({ projectId, version }: { projectId?: string; version?: string }) {
  const mutation = useMutation({ mutationFn: () => exportQuality(projectId, version),
    onSuccess: blob => saveBlobAsFile(blob, projectId ? `识别质量明细${version ? `-v${version}` : ""}.csv` : "识别质量汇总.csv") });
  return <div><button type="button" className="button back-cancel-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "正在导出…" : projectId ? "导出明细" : "导出汇总"}</button>
    {mutation.isError ? <p className="text-sm text-red-700" role="alert">{message(mutation.error)}</p> : null}</div>;
}

function QualityList() {
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const search = params.get("search") ?? "";
  const sort = ["recent", "score", "missed"].includes(params.get("sort") ?? "") ? params.get("sort")! : "recent";
  const [searchDraft, setSearchDraft] = useState(search);
  const query = useQuery(qualityCatalogOptions(page, search, sort));
  const update = (values: Record<string, string>) => setParams({ search, sort, page: "1", ...values });
  if (query.isPending) return <p role="status" className="p-6">正在加载识别质量…</p>;
  if (query.isError) return <p role="alert" className="p-6 text-red-700">{message(query.error)} <button type="button" onClick={() => void query.refetch()}>重新加载</button></p>;
  const { overview, items, total } = query.data;
  return <div className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm leading-6 text-slate-600">已正式评估 {overview.evaluated_projects}/{overview.total_projects} 个项目 · {overview.evaluated_photos} 张评估照片<br />全部项目复核覆盖率 {percent(overview.coverage)} · 排除 {overview.excluded_photos} 张</p>
      <ExportButton />
    </div>
    <Metrics value={overview.metrics} />
    <p className="text-sm leading-6 text-slate-500">整体指标汇总有效版本的正确、误检和漏检数量后计算。无缺陷照片判对 {overview.empty_correct_photos}/{overview.empty_truth_photos} 张；双方均无框时，对象级评分显示“—”。</p>
    <CategoryTable values={overview.by_type} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form className="flex min-w-0 flex-wrap gap-2" onSubmit={event => { event.preventDefault(); update({ search: searchDraft }); }}>
        <input className={`${field} min-w-0`} aria-label="搜索项目" placeholder="项目编号或名称" value={searchDraft} maxLength={128} onChange={event => setSearchDraft(event.target.value)} />
        <button className="button back-cancel-button" type="submit">搜索</button>
      </form>
      <select className={field} aria-label="项目排序" value={sort} onChange={event => update({ sort: event.target.value })}>
        <option value="recent">最近更新</option><option value="score">评分从低到高</option><option value="missed">漏检从多到少</option>
      </select>
    </div>
    <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full" aria-label="项目识别质量"><thead className="bg-slate-50"><tr>
        {["项目", "复核进度", "准确率", "召回率", "评分", "误检 / 漏检", "评估版本", "操作"].map(title => <th key={title} className={cell} scope="col">{title}</th>)}
      </tr></thead><tbody>{items.map(item => {
        const m = item.evaluation?.summary.metrics;
        return <tr key={item.project_id}>
          <td className={cell}><Link className="text-action" to={`/recognition-quality/${item.project_id}`}>{item.project_name}</Link><p className="mt-1 text-xs text-slate-500">{item.project_no}</p></td>
          <td className={cell}>{item.reviewed_photos}/{item.total_photos} 张<p className="mt-1 text-xs text-slate-500">覆盖 {percent(item.coverage)} · 排除 {item.excluded_photos} 张</p></td>
          <td className={cell}>{percent(m?.precision)}</td><td className={cell}>{percent(m?.recall)}</td><td className={cell}>{score(m?.score)}</td>
          <td className={cell}>{m ? `${m.fp} / ${m.fn}` : "—"}</td>
          <td className={cell}>{item.evaluation ? `v${item.evaluation.version}` : "待评估"}<p className="mt-1 text-xs text-slate-500">{item.evaluation ? formatDateTime(item.evaluation.created_at) : item.task_status === "success" ? "完成逐图复核及审核后生成" : "检测尚未完成"}</p></td>
          <td className={cell}><Link className="text-action" to={`/recognition-quality/${item.project_id}`}>查看比对</Link></td>
        </tr>;
      })}</tbody></table>
      {!items.length ? <p className="p-8 text-center text-slate-500">暂无符合条件的专业检测项目。</p> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>共 {total} 个项目 · 第 {page}/{Math.max(1, Math.ceil(total / 20))} 页</span>
      <div className="flex gap-2"><button type="button" className="button back-cancel-button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>上一页</button><button type="button" className="button back-cancel-button" disabled={page * 20 >= total} onClick={() => update({ page: String(page + 1) })}>下一页</button></div>
    </div>
    <p className="text-xs text-slate-500">规则 {overview.rule.version} · 同类别一对一匹配，IoU ≥ 0.5。评分依据人工复核版本。</p>
  </div>;
}

function focusView(photo: QualityPhoto, selected: QualityMatch | null) {
  const width = photo.width || 1200, height = photo.height || 800;
  const boxes = [selected?.prediction, selected?.truth].filter((box): box is QualityBox => Boolean(box)).map(box => box.bbox);
  if (!boxes.length) return `0 0 ${width} ${height}`;
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  const padding = Math.max(right - left, bottom - top, Math.min(width, height) * 0.05) * 0.5;
  const x = Math.max(0, left - padding), y = Math.max(0, top - padding);
  return `${x} ${y} ${Math.min(width, right + padding) - x} ${Math.min(height, bottom + padding) - y}`;
}

function ComparisonImage({ photo, side, boxes, selected }: { photo: QualityPhoto; side: "prediction" | "truth"; boxes: QualityBox[]; selected: QualityMatch | null }) {
  const selectedId = selected?.[side]?.id;
  const color = side === "prediction" ? "#ea580c" : "#2563eb";
  return <figure className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <figcaption className="p-3 text-sm font-medium" style={{ color }}>{side === "prediction" ? "AI 初始识别框" : "人工确认标注框"} · {boxes.length} 个</figcaption>
    <svg className="block aspect-[4/3] w-full bg-slate-100" viewBox={focusView(photo, selected)} role="img" aria-label={`${photo.filename} ${side === "prediction" ? "AI 初始识别" : "人工确认"}`}>
      <title>{photo.filename}</title>
      {photo.image_url ? <image href={photo.image_url} width={photo.width || 1200} height={photo.height || 800} /> : null}
      {boxes.map(box => <rect key={box.id} x={box.bbox.x} y={box.bbox.y} width={box.bbox.width} height={box.bbox.height} fill={selectedId === box.id ? `${color}30` : "none"}
        stroke={color} strokeWidth={selectedId === box.id ? 4 : 2} vectorEffect="non-scaling-stroke" opacity={selectedId && selectedId !== box.id ? 0.3 : 1}><title>{categories[box.defect_type] ?? box.defect_type} · {box.id}</title></rect>)}
    </svg>
  </figure>;
}

function PhotoComparison({ photos }: { photos: QualityPhoto[] }) {
  const [photoKey, setPhotoKey] = useState(photos[0]?.photo_key ?? "");
  const [filter, setFilter] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const photo = photos.find(p => p.photo_key === photoKey) ?? photos[0];
  if (!photo) return null;
  const details = photo.details.map((match, index) => ({ match, index })).filter(({ match }) => filter === "all" || match.kind === filter);
  const selected = selectedIndex == null ? null : photo.details[selectedIndex] ?? null;
  const boxes = (side: "prediction" | "truth") => filter === "all" ? (side === "prediction" ? photo.predictions : photo.truth)
    : details.flatMap(({ match }) => match[side] ? [match[side]!] : []);
  return <section className="grid min-w-0 gap-4" aria-label="逐图识别比对">
    <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-lg font-semibold text-ink">照片比对</h2>
      <select className={`${field} max-w-full`} aria-label="选择比对照片" value={photo.photo_key} onChange={event => { setPhotoKey(event.target.value); setSelectedIndex(null); }}>
        {photos.map(p => <option key={p.photo_key} value={p.photo_key}>{p.filename} · {p.review_state === "reviewed" ? `误检 ${p.metrics?.fp ?? 0} / 漏检 ${p.metrics?.fn ?? 0}` : p.review_state === "excluded" ? "无法评估" : "待复核"}</option>)}
      </select>
      <select className={field} aria-label="筛选比对结果" value={filter} onChange={event => { setFilter(event.target.value); setSelectedIndex(null); }}>
        <option value="all">全部结果</option>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select>
      {selected ? <button type="button" className="button back-cancel-button" onClick={() => setSelectedIndex(null)}>显示全图</button> : null}
    </div>
    {photo.review_state !== "reviewed" ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{photo.review_state === "excluded" ? `本图不参与评估：${photo.exclusion_reason}` : "本图尚未确认，不参与指标计算。右侧显示当前保存的标注。"}</p> : null}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2"><ComparisonImage photo={photo} side="prediction" boxes={boxes("prediction")} selected={selected} /><ComparisonImage photo={photo} side="truth" boxes={boxes("truth")} selected={selected} /></div>
    <p className="text-xs text-slate-500">点击下方结果可放大定位。橙色为原始 AI 框，蓝色为人工框。复核时间：{photo.reviewed_at ? formatDateTime(photo.reviewed_at) : "—"}</p>
    <div className="max-h-80 overflow-auto rounded-lg border border-slate-200" aria-label="标注比对明细">
      {details.map(({ match, index }) => <button className={`flex w-full flex-wrap items-center gap-3 border-b border-slate-100 p-3 text-left text-sm ${selectedIndex === index ? "bg-action-soft" : "bg-white"}`} key={index} type="button" aria-pressed={selectedIndex === index} onClick={() => setSelectedIndex(index)}>
        <span className={match.kind === "tp" ? "text-green-700" : match.kind === "fp" ? "text-orange-700" : "text-red-700"}>{kinds[match.kind]}</span>
        <span>{categories[(match.prediction ?? match.truth)!.defect_type] ?? (match.prediction ?? match.truth)!.defect_type}</span>
        <span className="text-slate-500">IoU {match.iou == null ? "—" : match.iou.toFixed(3)}</span>
        {match.prediction?.model_version ? <span className="ml-auto text-xs text-slate-500">{match.prediction.model_version}</span> : null}
      </button>)}
      {!details.length ? <p className="p-4 text-sm text-slate-500">{photo.review_state === "reviewed" ? "当前筛选下没有标注比对记录。" : "本图尚无有效比对结果。"}</p> : null}
    </div>
  </section>;
}

function QualityProjectDetail({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const version = params.get("version") ?? "";
  const query = useQuery(qualityDetailOptions(projectId, version));
  if (query.isPending) return <p className="p-6" role="status">正在加载项目评估…</p>;
  if (query.isError) return <p className="p-6 text-red-700" role="alert">{message(query.error)} <button type="button" onClick={() => void query.refetch()}>重新加载</button></p>;
  const data = query.data;
  return <div className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-center gap-3"><Link className="text-action" to="/recognition-quality">← 返回质量列表</Link>
      <Link className="ml-auto text-action" to={`/review/detections/${data.task_id}`}>进入审核</Link><ExportButton projectId={projectId} version={version} /></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold text-ink">{data.project_name}</h1><p className="mt-1 text-sm text-slate-500">{data.project_no}</p></div>
      <select className={field} aria-label="选择评估版本" value={version} onChange={event => setParams(event.target.value ? { version: event.target.value } : {})}>
        <option value="">当前有效评估 / 阶段性结果</option>{data.history.map(v => <option key={v.id} value={v.version}>历史 v{v.version} · {formatDateTime(v.created_at)}</option>)}
      </select></div>
    {data.unavailable_reason ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="status">暂时无法评估：{data.unavailable_reason}</p> : null}
    {data.summary ? <>
      <p className={`rounded-lg p-4 text-sm leading-6 ${data.evaluation ? "bg-action-soft text-ink" : "bg-amber-50 text-amber-900"}`} role="status">
        {data.evaluation ? `正式评估 v${data.evaluation.version} · ${formatDateTime(data.evaluation.created_at)}` : data.needs_completion ? "逐图复核已完成，请进入审核预览并完成审核，生成正式评估版本。" : data.summary.total_photos === data.summary.excluded_photos ? "全部照片均无法评估，暂无有效样本，不生成评分。" : "阶段性结果：只统计明确复核过的照片，尚未计入全局评分。"}<br />
        已复核 {data.summary.reviewed_photos}/{data.summary.total_photos} 张 · 覆盖率 {percent(data.summary.coverage)} · 排除 {data.summary.excluded_photos} 张 · 待复核 {data.summary.pending_photos} 张
      </p>
      <Metrics value={data.summary.metrics} /><CategoryTable values={data.summary.by_type} />
      <p className="text-sm text-slate-500">无缺陷照片判对 {data.summary.empty_correct_photos}/{data.summary.empty_truth_photos} 张。规则 {data.summary.rule.version} · IoU ≥ {data.summary.rule.iou_threshold} · F1 × 100。</p>
    </> : null}
    <PhotoComparison key={`${projectId}-${version}-${data.evaluation?.id ?? "draft"}`} photos={data.photos} />
  </div>;
}

export function RecognitionQualityPage() {
  const { id } = useParams();
  return <div className="recognition-quality-page management-list-page"><div className="project-workspace"><div className="project-list-panel workbench-result-list-panel">
    <div className="min-w-0 p-4 sm:p-6">{id ? <QualityProjectDetail projectId={id} /> : <QualityList />}</div>
  </div></div></div>;
}
