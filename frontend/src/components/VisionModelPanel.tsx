import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { controlVisionModel, deleteVisionModel, saveVisionModel, visionModelsQueryOptions, type VisionModel, type VisionModelEdit } from "@/api/detectionStrategies";
import { DeleteDialog, EditorDialog } from "@/components/ModelDialogs";
import { ModelRuntimeSwitch } from "@/components/ModelRuntimeSwitch";

function VisionEditor({ model, kind, onClose, onSaved }: { model: VisionModel | null; kind: VisionModelEdit["kind"]; onClose: () => void; onSaved: () => void }) {
  const label = kind === "local_vlm" ? "视觉模型" : "云端 API";
  const [form, setForm] = useState<VisionModelEdit>(model ? { name: model.name, kind: model.kind, model_name: model.model_name, api_base_url: model.api_base_url, api_key_env: model.api_key_env, model_path: model.model_path } : { name: "", kind, model_name: "", api_base_url: "", api_key_env: kind === "local_vlm" ? "LOCAL_QWEN_API_KEY" : "DASHSCOPE_API_KEY", model_path: "" });
  const mutation = useMutation({ mutationFn: () => saveVisionModel(model, form), onSuccess: onSaved });
  const valid = Boolean(form.name.trim());
  return <EditorDialog title={`${model ? "编辑" : "新增"}${label}`} formId="vision-model-editor" pending={mutation.isPending} disabled={!valid} error={mutation.error} onClose={onClose}>
    <form id="vision-model-editor" onSubmit={event => { event.preventDefault(); if (valid && !mutation.isPending) mutation.mutate(); }}><fieldset className="yolo-editor-fields" disabled={mutation.isPending}>
      <label className="form-field"><span>模型名称</span><input required maxLength={128} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="form-field yolo-editor-description"><span>API Key 环境变量名称</span><input maxLength={128} placeholder="例如 DASHSCOPE_API_KEY" value={form.api_key_env} onChange={event => setForm({ ...form, api_key_env: event.target.value })} /></label>
      {form.kind === "local_vlm" ? <label className="form-field yolo-editor-description"><span>服务器模型目录</span><input maxLength={512} placeholder="例如 /models/Qwen3-VL" value={form.model_path} onChange={event => setForm({ ...form, model_path: event.target.value })} /></label> : null}
    </fieldset><p className="system-settings-message">填写服务端保存 API Key 的变量名称。服务须兼容视觉 chat/completions 接口；新增模型的服务地址和服务模型名称沿用服务器配置。</p>{form.kind === "local_vlm" ? <p className="system-settings-message is-warning">本地启停需在 Linux 模型服务器启用并配置 vLLM。此处可以先保存配置。</p> : null}</form>
  </EditorDialog>;
}

export function VisionModelPanel({ kind, createOpen, onCreateClose }: { kind: VisionModelEdit["kind"]; createOpen: boolean; onCreateClose: () => void }) {
  const label = kind === "local_vlm" ? "视觉模型" : "云端 API";
  const query = useQuery(visionModelsQueryOptions);
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ model: VisionModel | null } | null>(null);
  const [deleting, setDeleting] = useState<VisionModel | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (createOpen) { setEditor({ model: null }); onCreateClose(); } }, [createOpen, onCreateClose]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(id); }, [notice]);
  async function refresh() { await client.invalidateQueries({ queryKey: visionModelsQueryOptions.queryKey }); }
  const runtime = useMutation({ mutationFn: ({ model, action }: { model: VisionModel; action: "start" | "stop" }) => controlVisionModel(model, action), onSuccess: async result => { setNotice(result.message); await refresh(); } });
  const remove = useMutation({ mutationFn: deleteVisionModel, onSuccess: async () => { setDeleting(null); setNotice(`${label}已删除。`); await refresh(); } });
  const labels: Record<string, string> = { running: "运行中", starting: "正在启动", stopping: "正在停止", stopped: "已停止", disabled: "当前不可启停", error: "运行异常", configured: "已配置", unconfigured: "未配置" };
  return <div className="yolo-model-list-section">
    {notice ? <p role="status" className="system-settings-message">{notice}</p> : null}
    {query.isPending ? <p role="status">正在读取{label}…</p> : null}
    {query.error || runtime.error ? <p className="system-settings-message is-error" role="alert">{(query.error || runtime.error)?.message}</p> : null}
    <div className="yolo-table-wrap"><table className="yolo-vision-table account-table" aria-label={`${label}列表`}><thead><tr><th>模型名称</th><th>运行状态</th><th>管理操作</th></tr></thead><tbody>{query.data?.filter(model => model.kind === kind).map(model => <tr key={model.id}>
      <td><strong>{model.name}</strong></td>
      <td><span className={`provider-option-status is-${model.runtime_status}`}>{labels[model.runtime_status] ?? model.runtime_status}</span><small>{model.runtime_message}</small></td>
      <td><div className="yolo-version-actions">{model.kind === "local_vlm" ? <ModelRuntimeSwitch label={model.name} status={model.runtime_status} message={model.runtime_message} supported={model.control_supported} active={model.runtime_active} disabled={runtime.isPending} pendingAction={runtime.isPending && runtime.variables?.model.id === model.id ? runtime.variables.action : undefined} onChange={action => runtime.mutate({ model, action })} /> : null}<button aria-label={`编辑 ${model.name}`} className="back-cancel-button" disabled={model.runtime_status === "running" || model.runtime_status === "starting"} type="button" onClick={() => setEditor({ model })}><Pencil aria-hidden="true" /></button><button aria-label={`删除 ${model.name}`} className="back-cancel-button" disabled={model.builtin || model.runtime_status === "running" || model.runtime_status === "starting"} type="button" onClick={() => { remove.reset(); setDeleting(model); }}><Trash2 aria-hidden="true" /></button></div></td>
    </tr>)}</tbody></table></div>
    {editor ? <VisionEditor model={editor.model} kind={kind} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice(`${label}已保存。`); void refresh(); }} /> : null}
    {deleting ? <DeleteDialog title={`删除${label}`} pending={remove.isPending} error={remove.error} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)}><p>确定删除“{deleting.name}”？被检测策略引用的模型需先解除绑定。</p></DeleteDialog> : null}
  </div>;
}
