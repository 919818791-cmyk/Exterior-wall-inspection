import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Save } from "lucide-react";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useOutletContext } from "react-router-dom";
import { saveStrategies, strategiesQueryOptions, visionModelsQueryOptions, type DetectionStrategy, type ModelKind } from "@/api/detectionStrategies";
import { yoloModelsQueryOptions } from "@/api/yoloModels";

export function DetectionPromptsPage() {
  const { setListPageHeaderAction } = useOutletContext<{ setListPageHeaderAction: Dispatch<SetStateAction<ReactNode>> }>();
  const client = useQueryClient();
  const query = useQuery(strategiesQueryOptions);
  const vision = useQuery(visionModelsQueryOptions);
  const yolo = useQuery(yoloModelsQueryOptions);
  const [form, setForm] = useState<DetectionStrategy[] | null>(null);
  const [activeKey, setActiveKey] = useState("visible_prompt");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (query.data) setForm(current => current ?? query.data); }, [query.data]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(""), 3000); return () => clearTimeout(id); }, [notice]);
  const save = useMutation({ mutationFn: saveStrategies, onSuccess: async items => {
    setForm(items); client.setQueryData(strategiesQueryOptions.queryKey, items); setNotice("检测策略已保存。");
    await client.invalidateQueries({ queryKey: ["system-settings"] });
  } });
  const hasForm = Boolean(form);
  useEffect(() => {
    setListPageHeaderAction(<button className="list-page-header-action primary-action-button" disabled={!hasForm || save.isPending} form="detection-strategies-form" type="submit"><Save aria-hidden="true" />{save.isPending ? "正在保存…" : "保存策略"}</button>);
    return () => setListPageHeaderAction(null);
  }, [hasForm, save.isPending, setListPageHeaderAction]);
  const active = form?.find(item => item.key === activeKey);
  const groups = [...new Map(form?.map(item => [item.facade_type, item.facade_label]) ?? []).entries()];
  const options = form?.filter(item => item.facade_type === active?.facade_type) ?? [];
  function update(values: Partial<DetectionStrategy>) { save.reset(); setForm(items => items?.map(item => item.key === activeKey ? { ...item, ...values } : item) ?? null); }
  const candidates = active?.model_kind === "yolo"
    ? (yolo.data?.items ?? [])
    : (vision.data ?? []).filter(model => model.kind === active?.model_kind);
  const selectedYolo = yolo.data?.items.find(model => model.id === active?.model_id);
  const selectedVersion = selectedYolo?.versions.find(version => version.id === active?.version_id);
  const selectedVision = vision.data?.find(model => model.id === active?.model_id);
  const modelError = vision.isError || yolo.isError;
  const error = save.error || query.error || vision.error || yolo.error;
  return <div className="prompt-settings-page management-list-page">
    {notice ? <div className="system-settings-toast" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div> : null}
    <div className="project-workspace"><form className="project-list-panel" id="detection-strategies-form" aria-label="检测策略配置项" onSubmit={event => { event.preventDefault(); if (form && !save.isPending) save.mutate(form); }}>
      {query.isPending ? <div className="system-settings-loading">正在读取检测策略…</div> : null}
      {error ? <div className="system-settings-message is-error" role="alert">{error instanceof Error ? error.message : "配置读取失败。"}</div> : null}
      {active ? <div className="prompt-setting-block">
        <fieldset className="prompt-setting-heading" disabled={save.isPending}>
          <label className="prompt-setting-filter-column"><span className="prompt-setting-filter-title">外墙类型</span><div className="select-control"><select value={active.facade_type} onChange={event => { const first = form?.find(item => item.facade_type === event.target.value); if (first) setActiveKey(first.key); }}>{groups.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
          <label className="prompt-setting-filter-column"><span className="prompt-setting-filter-title">检测项</span><div className="select-control"><select value={activeKey} onChange={event => setActiveKey(event.target.value)}>{options.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
            <label className="prompt-setting-filter-column"><span className="prompt-setting-filter-title">模型来源</span><div className="select-control"><select value={active.model_kind} onChange={event => update({ model_kind: event.target.value as ModelKind, model_id: null, version_id: null })}><option value="cloud_api">云端 API</option><option value="local_vlm">本地视觉大模型</option><option value="yolo">YOLO 模型</option><option value="unconfigured">未配置</option></select><ChevronDown aria-hidden="true" /></div></label>
            {active.model_kind !== "unconfigured" ? <label className="prompt-setting-filter-column"><span className="prompt-setting-filter-title">指定模型</span><div className="select-control"><select disabled={modelError} value={active.model_id ?? ""} onChange={event => update({ model_id: event.target.value || null, version_id: null })}><option value="">请选择模型</option>{active.model_id && !candidates.some(model => model.id === active.model_id) ? <option value={active.model_id}>当前模型不可用，请重新选择</option> : null}{candidates.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown aria-hidden="true" /></div></label> : null}
            {active.model_kind === "yolo" && selectedYolo ? <label className="prompt-setting-filter-column"><span className="prompt-setting-filter-title">权重版本</span><div className="select-control"><select required value={active.version_id ?? ""} onChange={event => update({ version_id: event.target.value || null })}><option value="">{selectedYolo.versions.length ? "请选择权重版本" : "请先上传权重版本"}</option>{active.version_id && !selectedVersion ? <option value={active.version_id}>已绑定版本不可用，请重新选择</option> : null}{selectedYolo.versions.map(item => <option key={item.id} value={item.id}>{item.version}{item.runtime_status === "running" ? "（运行中）" : ""}</option>)}</select><ChevronDown aria-hidden="true" /></div></label> : null}
        </fieldset>
        {active.model_kind === "yolo" ? <p className="system-settings-message is-warning">{selectedVersion?.runtime_message || "请选择具体权重版本，各版本可在模型管理中独立启停。"}</p> : selectedVision && (!selectedVision.configured || selectedVision.kind === "local_vlm") ? <p className="system-settings-message is-warning">{selectedVision.runtime_message}</p> : null}
        {active.model_kind === "unconfigured" ? <p className="system-settings-message is-warning">该检测项尚未配置模型，执行时会提示配置，不会自动使用其他检测项的模型。</p> : null}
        {active.model_kind === "yolo" ? <p className="system-settings-message">YOLO 使用指定权重完成检测，无需提示词。</p> : <div className="prompt-setting-editor"><textarea aria-label={`${active.facade_label} · ${active.label}提示词内容`} value={active.prompt} disabled={save.isPending} onChange={event => update({ prompt: event.target.value })} /></div>}
      </div> : null}
    </form></div>
  </div>;
}
