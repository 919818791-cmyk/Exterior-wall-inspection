import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createProject } from "@/api/projects";
import { ProjectLocationMap } from "@/components/project/ProjectLocationMap";
import type { ProjectCreatePayload } from "@/types/projects";

interface FacadeDraft { localId: string; name: string; area: string; floors_range: string; description: string }
interface BuildingDraft { localId: string; name: string; floors: string; height: string; facades: FacadeDraft[] }
interface ProjectDraft { name: string; address: string; contact_name: string; contact_phone: string; longitude: string; latitude: string; buildings: BuildingDraft[] }
const facade = (): FacadeDraft => ({ localId: crypto.randomUUID(), name: "", area: "", floors_range: "", description: "" });
const building = (): BuildingDraft => ({ localId: crypto.randomUUID(), name: "", floors: "", height: "", facades: [facade()] });
const initialProject: ProjectDraft = { name: "", address: "", contact_name: "", contact_phone: "", longitude: "", latitude: "", buildings: [building()] };
const cleanText = (value: string) => value.trim() || null;
const cleanNumber = (value: string) => value.trim() ? Number(value.trim()) : null;
const cleanDecimal = (value: string) => value.trim() || null;

function toPayload(form: ProjectDraft): { payload: ProjectCreatePayload | null; error: string } {
  if (!form.name.trim()) return { payload: null, error: "请填写项目名称。" };
  if (!form.buildings.length) return { payload: null, error: "请至少添加一栋建筑。" };
  for (const [buildingIndex, item] of form.buildings.entries()) {
    if (!item.name.trim()) return { payload: null, error: `请填写第 ${buildingIndex + 1} 栋建筑名称。` };
    if (!item.facades.length) return { payload: null, error: `请为“${item.name.trim()}”至少添加一个检测立面。` };
    for (const [facadeIndex, side] of item.facades.entries()) if (!side.name.trim()) return { payload: null, error: `请填写“${item.name.trim()}”第 ${facadeIndex + 1} 个立面名称。` };
  }
  return { error: "", payload: { name: form.name.trim(), address: cleanText(form.address), contact_name: cleanText(form.contact_name), contact_phone: cleanText(form.contact_phone), longitude: cleanDecimal(form.longitude), latitude: cleanDecimal(form.latitude), buildings: form.buildings.map((item, index) => ({ name: item.name.trim(), floors: cleanNumber(item.floors), height: cleanDecimal(item.height), sort_order: index, facades: item.facades.map((side, sideIndex) => ({ name: side.name.trim(), area: cleanDecimal(side.area), floors_range: cleanText(side.floors_range), description: cleanText(side.description), sort_order: sideIndex })) })) } };
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectDraft>(initialProject);
  const [formError, setFormError] = useState("");
  const createMutation = useMutation({ mutationFn: createProject, onSuccess: async (project) => { await queryClient.invalidateQueries({ queryKey: ["projects"] }); navigate(`/projects/${project.id}`); } });
  const field = (name: keyof Omit<ProjectDraft, "buildings">, value: string) => { setForm((current) => ({ ...current, [name]: value })); setFormError(""); };
  const updateProjectPosition = (position: { longitude: number; latitude: number }) => { setForm((current) => ({ ...current, longitude: position.longitude.toFixed(7), latitude: position.latitude.toFixed(7) })); setFormError(""); };
  const updateBuilding = (id: string, name: keyof Omit<BuildingDraft, "localId" | "facades">, value: string) => { setForm((current) => ({ ...current, buildings: current.buildings.map((item) => item.localId === id ? { ...item, [name]: value } : item) })); setFormError(""); };
  const updateFacade = (buildingId: string, facadeId: string, name: keyof Omit<FacadeDraft, "localId">, value: string) => { setForm((current) => ({ ...current, buildings: current.buildings.map((item) => item.localId !== buildingId ? item : { ...item, facades: item.facades.map((side) => side.localId === facadeId ? { ...side, [name]: value } : side) }) })); setFormError(""); };
  const addBuilding = () => setForm((current) => ({ ...current, buildings: [...current.buildings, building()] }));
  const removeBuilding = (id: string) => setForm((current) => ({ ...current, buildings: current.buildings.filter((item) => item.localId !== id) }));
  const addFacade = (id: string) => setForm((current) => ({ ...current, buildings: current.buildings.map((item) => item.localId === id ? { ...item, facades: [...item.facades, facade()] } : item) }));
  const removeFacade = (buildingId: string, facadeId: string) => setForm((current) => ({ ...current, buildings: current.buildings.map((item) => item.localId !== buildingId ? item : { ...item, facades: item.facades.filter((side) => side.localId !== facadeId) }) }));
  function handleSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = toPayload(form); if (!result.payload) { setFormError(result.error); return; } setFormError(""); createMutation.mutate(result.payload); }

  return <form className="create-workspace" onSubmit={handleSubmit}>
    <section className="create-section"><div className="create-section-heading"><span className="section-index">01</span><div><h2>项目基础信息</h2></div></div><div className="basic-layout"><div className="project-fields">
      <Label label="项目名称" required className="full-field"><input value={form.name} placeholder="请输入项目名称" onChange={(event) => field("name", event.target.value)} /></Label>
      <Label label="联系人"><input value={form.contact_name} placeholder="请输入联系人" onChange={(event) => field("contact_name", event.target.value)} /></Label>
      <Label label="联系电话"><input value={form.contact_phone} placeholder="请输入联系电话" onChange={(event) => field("contact_phone", event.target.value)} /></Label>
      <Label label="项目位置" className="full-field"><input value={form.address} placeholder="请输入详细地址" onChange={(event) => field("address", event.target.value)} /></Label>
    </div><ProjectLocationMap address={form.address} className="project-location-map" onPositionChange={updateProjectPosition} /></div></section>
    <section className="create-section"><div className="create-section-heading buildings-heading"><span className="section-index">02</span><div><h2>建筑与检测立面</h2></div><button className="add-building-button" type="button" onClick={addBuilding}><Plus aria-hidden="true" />添加建筑</button></div><div className="building-list">{form.buildings.map((item, buildingIndex) => <article key={item.localId} className="building-card"><div className="building-card-header"><div className="building-toggle"><span className="building-number">建筑 {buildingIndex + 1}</span><span className="building-heading-copy"><strong>{item.name || "未命名建筑"}</strong><small>维护建筑基础信息与检测立面</small></span></div><button aria-label="删除建筑" className="remove-building-button" disabled={form.buildings.length <= 1} type="button" onClick={() => removeBuilding(item.localId)}><Trash2 aria-hidden="true" />删除</button></div><div className="building-card-body"><div className="building-fields"><Label label="建筑名称" required><input value={item.name} placeholder="例如：A栋" onChange={(event) => updateBuilding(item.localId, "name", event.target.value)} /></Label><Label label="楼层数"><input value={item.floors} inputMode="numeric" placeholder="例如：28" onChange={(event) => updateBuilding(item.localId, "floors", event.target.value)} /></Label><Label label="建筑高度"><div className="unit-control"><input value={item.height} inputMode="decimal" placeholder="例如：96" onChange={(event) => updateBuilding(item.localId, "height", event.target.value)} /><em>m</em></div></Label></div><div className="facade-editor"><div className="facade-editor-heading"><div><h3>检测立面信息</h3></div><button className="add-facade-button" type="button" onClick={() => addFacade(item.localId)}><Plus aria-hidden="true" />添加立面</button></div><div className="facade-table-head"><span>序号</span><span>立面名称</span><span>操作</span></div><div className="facade-list">{item.facades.map((side, sideIndex) => <div key={side.localId} className="facade-row"><span className="facade-index">{String(sideIndex + 1).padStart(2, "0")}</span><label><span className="sr-only">立面名称</span><input value={side.name} placeholder="例如：东立面" onChange={(event) => updateFacade(item.localId, side.localId, "name", event.target.value)} /></label><button aria-label="删除立面" className="remove-facade-button" disabled={item.facades.length <= 1} type="button" onClick={() => removeFacade(item.localId, side.localId)}><Trash2 aria-hidden="true" /></button></div>)}</div></div></div></article>)}</div></section>
    {(formError || createMutation.isError) ? <p className="create-form-error">{formError || "保存失败，请稍后重试。"}</p> : null}
    <div className="create-action-bar"><div className="create-summary"><Check aria-hidden="true" />已配置 {form.buildings.length} 栋建筑、{form.buildings.reduce((total, item) => total + item.facades.length, 0)} 个检测立面</div><div><Link className="button secondary" to="/projects"><ArrowLeft aria-hidden="true" />返回列表</Link><button className="button primary" disabled={createMutation.isPending} type="submit"><Save aria-hidden="true" />{createMutation.isPending ? "正在保存" : "保存并进入详情"}</button></div></div>
  </form>;
}

function Label({ label, required, className = "", children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) { return <label className={`form-field ${className}`}><span>{label}{required ? <b>*</b> : null}</span>{children}</label>; }
