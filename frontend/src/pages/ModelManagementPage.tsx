import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Box, CheckCircle2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";

import { controlYoloVersion, createYoloModel, deleteYoloModel, deleteYoloVersion, editYoloModel, editYoloVersion, uploadYoloVersion, yoloModelsQueryOptions } from "@/api/yoloModels";
import type { YoloModel, YoloModelVersion } from "@/types/yoloModels";
import { formatDateTime } from "@/utils/projectDisplay";
import "@/styles/yolo-models.css";
import { DeleteDialog, EditorDialog } from "@/components/ModelDialogs";
import { VisionModelPanel } from "@/components/VisionModelPanel";
import { ModelRuntimeSwitch } from "@/components/ModelRuntimeSwitch";

function fileSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function versionStatus(version: YoloModelVersion) {
  return ({ running: "运行中", starting: "正在启动", stopping: "正在停止", stopped: "已停止", failed: "启动失败", disabled: "未接入" } as Record<string, string>)[version.runtime_status] ?? "状态未知";
}

function versionBusy(version: YoloModelVersion) {
  return ["running", "starting", "stopping"].includes(version.runtime_status);
}

function UploadModelModal({ model, maxBytes, onClose, onUploaded }: {
  model: YoloModel; maxBytes: number;
  onClose: () => void; onUploaded: (version: YoloModelVersion) => void;
}) {
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [validationError, setValidationError] = useState("");
  const mutation = useMutation({
    mutationFn: (body: FormData) => uploadYoloVersion(model.id, body, (value) => setProgress(value.percent)),
    onSuccess: onUploaded
  });
  const pending = mutation.isPending;

  function submit() {
    if (pending) return;
    setValidationError("");
    mutation.reset();
    if (!version.trim()) { setValidationError("请输入版本号。"); return; }
    if (!file || !file.name.toLowerCase().endsWith(".pt")) { setValidationError("请选择 YOLO .pt 权重文件。"); return; }
    if (!file.size || file.size > maxBytes) { setValidationError(`文件不能为空，大小不能超过 ${fileSize(maxBytes)}。`); return; }
    if (model.versions.some((item) => item.version === version.trim())) {
      setValidationError("该模型已存在相同版本号，请使用新的版本号。"); return;
    }
    const body = new FormData();
    body.set("version", version.trim());
    body.set("description", description.trim()); body.set("file", file);
    setProgress(0);
    mutation.mutate(body);
  }

  return (
    <Modal classNames={{ backdrop: "start-detection-modal-backdrop", base: "start-detection-modal-content", wrapper: "start-detection-modal-wrapper" }} hideCloseButton isOpen isDismissable={!pending} isKeyboardDismissDisabled={pending} placement="center" onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <ModalContent>
        <button aria-label="关闭上传模型弹窗" className="start-detection-modal-close back-cancel-button" disabled={pending} type="button" onClick={onClose}><X aria-hidden="true" /></button>
        <ModalHeader className="start-detection-modal-header"><span className="start-detection-modal-title-copy">上传模型版本</span></ModalHeader>
        <ModalBody className="start-detection-modal-body">
          <form className="yolo-upload-form" id="yolo-upload-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <fieldset className="yolo-upload-fields" disabled={pending}>
              <label className="form-field"><span>所属模型</span><input readOnly value={model.name} /></label>
              <label className="form-field"><span>版本号</span><input maxLength={64} required value={version} placeholder="例如 v1.0.0" onChange={(event) => setVersion(event.target.value)} /></label>
              <label className="form-field yolo-upload-file"><span>权重文件</span><input accept=".pt" required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>支持 .pt 文件，最大 {fileSize(maxBytes)}{file ? ` · 已选择 ${fileSize(file.size)}` : ""}</small></label>
              <label className="form-field yolo-upload-description"><span>版本说明（选填）</span><textarea maxLength={2000} rows={3} value={description} placeholder="记录训练数据、适用场景或本次改进" onChange={(event) => setDescription(event.target.value)} /></label>
            </fieldset>
            {pending ? <div className="yolo-upload-progress" role="status"><progress aria-label="模型上传进度" value={progress} max={100} /><span>{progress === 100 ? "文件已发送，正在保存…" : `正在上传 ${progress}%`}</span></div> : null}
            {validationError || mutation.isError ? <p className="project-photo-error" role="alert">{validationError || errorMessage(mutation.error)}</p> : null}
          </form>
        </ModalBody>
        <ModalFooter className="start-detection-modal-footer"><button className="back-cancel-button" disabled={pending} type="button" onClick={onClose}>取消</button><button className="button primary-action-button" disabled={pending} form="yolo-upload-form" type="submit"><Upload aria-hidden="true" />{pending ? "正在上传…" : "上传版本"}</button></ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ModelEditorModal({ model, onClose, onSaved }: {
  model: YoloModel | null; onClose: () => void; onSaved: (model: YoloModel) => void;
}) {
  const [name, setName] = useState(model?.name ?? "");
  const [description, setDescription] = useState(model?.description ?? "");
  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description };
      return model ? editYoloModel(model.id, payload) : createYoloModel(payload);
    },
    onSuccess: onSaved
  });
  return <EditorDialog title={model ? "编辑模型" : "新增模型"} formId="yolo-model-editor" pending={mutation.isPending} error={mutation.error} disabled={!name.trim()} onClose={onClose}>
    <form id="yolo-model-editor" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !mutation.isPending) mutation.mutate(); }}>
      <fieldset className="yolo-editor-fields" disabled={mutation.isPending}>
        <label className="form-field yolo-editor-name"><span>模型名称</span><input maxLength={128} placeholder="例如 A 模型、外墙综合检测模型" required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="form-field yolo-editor-description"><span>模型说明（选填）</span><textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      </fieldset>
    </form>
  </EditorDialog>;
}

function VersionEditorModal({ item, onClose, onSaved }: { item: YoloModelVersion; onClose: () => void; onSaved: () => void }) {
  const [version, setVersion] = useState(item.version);
  const [description, setDescription] = useState(item.description ?? "");
  const mutation = useMutation({ mutationFn: () => editYoloVersion(item, { version: version.trim(), description }), onSuccess: onSaved });
  return <EditorDialog title="编辑模型版本" formId="yolo-version-editor" pending={mutation.isPending} error={mutation.error} disabled={!version.trim()} onClose={onClose}>
    <form id="yolo-version-editor" onSubmit={(event) => { event.preventDefault(); if (version.trim() && !mutation.isPending) mutation.mutate(); }}>
      <fieldset className="yolo-editor-fields" disabled={mutation.isPending}>
        <label className="form-field yolo-editor-version"><span>版本号</span><input maxLength={64} required value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <label className="form-field yolo-editor-description"><span>版本说明（选填）</span><textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      </fieldset>
    </form>
  </EditorDialog>;
}

export function ModelManagementPage() {
  const { setListPageHeaderAction } = useOutletContext<{ setListPageHeaderAction: Dispatch<SetStateAction<ReactNode>> }>();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const catalog = useQuery(yoloModelsQueryOptions);
  const selectedId = params.get("model");
  const visionTab = params.get("category") === "vision";
  const cloudTab = params.get("category") === "cloud";
  const visionKind = visionTab ? "local_vlm" : cloudTab ? "cloud_api" : null;
  const [visionCreateOpen, setVisionCreateOpen] = useState(false);
  const models = catalog.data?.items ?? [];
  const selected = models.find((item) => item.id === selectedId);
  const ready = Boolean(catalog.data);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [modelEditor, setModelEditor] = useState<{ model: YoloModel | null } | null>(null);
  const [versionEditor, setVersionEditor] = useState<YoloModelVersion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YoloModelVersion | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<YoloModel | null>(null);
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");

  async function refresh() { await queryClient.invalidateQueries({ queryKey: yoloModelsQueryOptions.queryKey }); }
  function openDetail(modelId: string) { setOperationError(""); setParams({ model: modelId }); }
  function closeDetail() { setOperationError(""); setParams({}); }
  const remove = useMutation({ mutationFn: deleteYoloVersion, onSuccess: async () => { setDeleteTarget(null); setNotice("模型版本已删除。"); await refresh(); } });
  const removeModel = useMutation({ mutationFn: deleteYoloModel, onSuccess: async () => { setDeleteModelTarget(null); setNotice("模型已删除。"); await refresh(); } });
  const runtime = useMutation({ mutationFn: ({ version, action }: { version: YoloModelVersion; action: "start" | "stop" }) => controlYoloVersion(version, action), onSuccess: async result => { setNotice(result.message); await refresh(); }, onError: error => setOperationError(errorMessage(error)) });

  useEffect(() => {
    setListPageHeaderAction(visionKind
      ? <button className="list-page-header-action primary-action-button" type="button" onClick={() => setVisionCreateOpen(true)}><Plus aria-hidden="true" />{visionTab ? "新增视觉模型" : "新增云端 API"}</button>
      : selectedId
      ? <button className="list-page-header-action primary-action-button" disabled={!ready || !selected} type="button" onClick={() => setUploadOpen(true)}><Upload aria-hidden="true" />新增版本</button>
      : <button className="list-page-header-action primary-action-button" disabled={!ready} type="button" onClick={() => setModelEditor({ model: null })}><Plus aria-hidden="true" />新增模型</button>);
    return () => setListPageHeaderAction(null);
  }, [ready, selectedId, Boolean(selected), visionKind, visionTab, setListPageHeaderAction]);

  useEffect(() => { setOperationError(""); }, [selectedId]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  return <div className="model-management-page management-list-page">
    {notice ? <div className="system-settings-toast" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div> : null}
    <div className="project-workspace"><div className="project-list-panel workbench-result-list-panel">
      <nav className="model-category-tabs" aria-label="模型类别">
        <Link aria-current={!visionKind ? "page" : undefined} to="/model-management">YOLO 模型</Link>
        <Link aria-current={visionTab ? "page" : undefined} to="/model-management?category=vision">视觉大模型</Link>
        <Link aria-current={cloudTab ? "page" : undefined} to="/model-management?category=cloud">云端 API</Link>
      </nav>
      {visionKind ? <VisionModelPanel key={visionKind} kind={visionKind} createOpen={visionCreateOpen} onCreateClose={() => setVisionCreateOpen(false)} /> : <>
      {catalog.isPending ? <div className="system-settings-loading" role="status">正在读取模型列表…</div> : null}
      {catalog.isError ? <div className="system-settings-message is-error" role="alert"><span>{errorMessage(catalog.error)}</span><button className="table-action" type="button" onClick={() => void catalog.refetch()}>重新加载</button></div> : null}
      {catalog.data && !selectedId ? <div className="yolo-model-list-section">
        {models.length ? <div className="yolo-table-wrap"><table aria-label="YOLO 模型列表" className="yolo-model-list account-table"><thead><tr><th scope="col">模型名称</th><th scope="col">版本数量</th><th scope="col">运行状态</th><th scope="col" className="account-actions-column">操作</th></tr></thead><tbody>
          {models.map((model) => {
            const runningCount = model.versions.filter(item => item.runtime_status === "running").length;
            return <tr key={model.id} tabIndex={0} aria-label={`打开：${model.name}`} onClick={() => openDetail(model.id)} onKeyDown={(event) => { if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); openDetail(model.id); }}>
            <td><button className="yolo-model-name" type="button" onClick={(event) => { event.stopPropagation(); openDetail(model.id); }}><strong>{model.name}</strong></button>{model.description ? <small>{model.description}</small> : null}</td>
            <td>{model.versions.length} 个版本</td>
            <td><span className={`status-tag ${runningCount > 0 ? "ready" : "neutral"}`}>{runningCount}个版本运行中</span></td>
            <td className="account-actions-column"><div className="table-actions"><button aria-label={`编辑 ${model.name}`} title="编辑模型" className="back-cancel-button" type="button" onClick={(event) => { event.stopPropagation(); setModelEditor({ model }); }}><Pencil aria-hidden="true" /></button><button aria-label={`删除 ${model.name}`} title="删除模型" className="back-cancel-button" type="button" onClick={(event) => { event.stopPropagation(); removeModel.reset(); setDeleteModelTarget(model); }}><Trash2 aria-hidden="true" /></button></div></td>
          </tr>;
          })}
        </tbody></table></div> : <div className="yolo-empty"><Box aria-hidden="true" /><h3>暂无模型</h3><button className="button primary-action-button" type="button" onClick={() => setModelEditor({ model: null })}><Plus aria-hidden="true" />新增模型</button></div>}
      </div> : null}
      {catalog.data && selectedId ? <section aria-label="模型详情" className="yolo-version-section">
        <div className="yolo-version-toolbar"><button className="back-cancel-button" type="button" onClick={closeDetail}><ArrowLeft aria-hidden="true" />返回列表</button>{selected ? <h2>{selected.name}</h2> : null}</div>
        {selected ? <p className="yolo-model-description">各版本独立启停，可同时运行多个版本；在检测策略中指定具体权重版本。</p> : null}
        {selected?.description ? <p className="yolo-model-description">{selected.description}</p> : null}
        {!selected ? <div className="system-settings-message is-error" role="alert">模型不存在或已删除。</div> : null}
        {operationError ? <div className="system-settings-message is-error" role="alert">{operationError}</div> : null}
        {selected?.versions.length ? <div className="yolo-table-wrap"><table aria-label="模型版本列表" className="yolo-version-table account-table"><thead><tr><th scope="col">版本 / 说明</th><th scope="col">上传时间</th><th scope="col">运行状态</th><th scope="col">管理操作</th></tr></thead><tbody>
          {selected.versions.map((item) => <tr key={item.id}>
            <td><strong>{item.version}</strong><small>{item.description || "暂无版本说明"}</small></td>
            <td>{formatDateTime(item.created_at)}</td>
            <td><span>{versionStatus(item)}</span><small>{item.runtime_message}</small></td>
            <td><div className="yolo-version-actions">
              <ModelRuntimeSwitch label={item.version} status={item.runtime_status} message={item.runtime_message} supported={item.control_supported} disabled={runtime.isPending} pendingAction={runtime.isPending && runtime.variables?.version.id === item.id ? runtime.variables.action : undefined} onChange={action => { setOperationError(""); runtime.mutate({ version: item, action }); }} />
              <button aria-label={`编辑 ${item.version}`} title="编辑版本" className="back-cancel-button" disabled={runtime.isPending} type="button" onClick={() => setVersionEditor(item)}><Pencil aria-hidden="true" /></button>
              <button aria-label={`删除 ${item.version}`} className="back-cancel-button" disabled={versionBusy(item) || runtime.isPending} title={versionBusy(item) ? "请先停止该版本" : "删除此版本及其权重文件"} type="button" onClick={() => { remove.reset(); setDeleteTarget(item); }}><Trash2 aria-hidden="true" /></button>
            </div></td>
          </tr>)}
        </tbody></table></div> : selected ? <div className="yolo-empty"><Box aria-hidden="true" /><h3>尚未上传模型版本</h3><button className="button primary-action-button" type="button" onClick={() => setUploadOpen(true)}><Upload aria-hidden="true" />新增版本</button></div> : null}
      </section> : null}
      </>}
    </div></div>
    {modelEditor ? <ModelEditorModal model={modelEditor.model} onClose={() => setModelEditor(null)} onSaved={() => { setModelEditor(null); setNotice("模型已保存。"); void refresh(); }} /> : null}
    {versionEditor ? <VersionEditorModal item={versionEditor} onClose={() => setVersionEditor(null)} onSaved={() => { setVersionEditor(null); setNotice("模型版本已保存。"); void refresh(); }} /> : null}
    {uploadOpen && selected && catalog.data ? <UploadModelModal model={selected} maxBytes={catalog.data.max_upload_bytes} onClose={() => setUploadOpen(false)} onUploaded={(item) => { setUploadOpen(false); openDetail(item.model_id); setNotice(`模型版本 ${item.version} 上传成功。`); void refresh(); }} /> : null}
    {deleteTarget ? <DeleteDialog title="删除模型版本" pending={remove.isPending} error={remove.error} onClose={() => setDeleteTarget(null)} onConfirm={() => remove.mutate(deleteTarget)}><p>确定删除 {deleteTarget.version} 及权重文件 {deleteTarget.original_filename}？删除后无法恢复。</p></DeleteDialog> : null}
    {deleteModelTarget ? <DeleteDialog title="删除模型" pending={removeModel.isPending} error={removeModel.error} onClose={() => setDeleteModelTarget(null)} onConfirm={() => removeModel.mutate(deleteModelTarget)}><p>确定删除“{deleteModelTarget.name}”？删除后将从列表移除，已有版本和权重文件将保留。新增模型会建立独立记录。</p></DeleteDialog> : null}
  </div>;
}
