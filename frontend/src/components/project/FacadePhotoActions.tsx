import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, ImageOff, Images, Trash2, Upload, UploadCloud, X } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  createUploadBatch,
  deletePhoto,
  projectPhotosQueryOptions,
  uploadPhoto
} from "@/api/projects";
import type { Building, Facade, PhotoType, ProjectDetail, UploadMode } from "@/types/projects";

type DroneModel = "dji" | "other";
type DialogName = "upload" | "manage" | null;

function formatFileSummary(files: File[]) {
  if (!files.length) return "尚未选择文件";
  return "已选择 " + files.length + " 张";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function FacadePhotoActions({
  building,
  facade,
  isEditable,
  project
}: {
  building: Building;
  facade: Facade;
  isEditable: boolean;
  project: ProjectDetail;
}) {
  const uploadDialogRef = useRef<HTMLDialogElement | null>(null);
  const managerDialogRef = useRef<HTMLDialogElement | null>(null);
  const queryClient = useQueryClient();
  const photosQuery = useQuery(projectPhotosQueryOptions(project.id));
  const facadePhotos = useMemo(
    () => (photosQuery.data ?? []).filter((photo) => photo.facade_id === facade.id),
    [facade.id, photosQuery.data]
  );
  const [dialog, setDialog] = useState<DialogName>(null);
  const [droneModel, setDroneModel] = useState<DroneModel>("dji");
  const [djiFiles, setDjiFiles] = useState<File[]>([]);
  const [visibleFiles, setVisibleFiles] = useState<File[]>([]);
  const [thermalFiles, setThermalFiles] = useState<File[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");

  const selectedPhoto = facadePhotos.find((photo) => photo.id === selectedPhotoId) ?? facadePhotos[0] ?? null;

  const invalidatePhotos = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id, "photos"] })
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fileGroups: Array<{ files: File[]; type: PhotoType }> = droneModel === "dji"
        ? [{ files: djiFiles, type: "dji" }]
        : [
            { files: visibleFiles, type: "visible" },
            { files: thermalFiles, type: "thermal" }
          ];

      if (fileGroups.some((group) => !group.files.length)) {
        throw new Error(droneModel === "dji" ? "请先选择无人机照片。" : "请分别选择可见光和热成像图片。");
      }

      const uploadMode: UploadMode = droneModel === "dji" ? "dji" : "mixed";
      const batch = await createUploadBatch(project.id, {
        building_id: building.id,
        drone_type: droneModel === "dji" ? "大疆型号" : "其他型号",
        facade_id: facade.id,
        remark: null,
        upload_mode: uploadMode
      });

      for (const group of fileGroups) {
        for (const file of group.files) {
          const formData = new FormData();
          formData.append("project_id", project.id);
          formData.append("upload_batch_id", batch.id);
          formData.append("building_id", building.id);
          formData.append("facade_id", facade.id);
          formData.append("photo_type", group.type);
          formData.append("file", file);
          await uploadPhoto(formData);
        }
      }
    },
    onSuccess: async () => {
      setDjiFiles([]);
      setVisibleFiles([]);
      setThermalFiles([]);
      setLocalError("");
      setDialog(null);
      await invalidatePhotos();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: async () => {
      setSelectedPhotoId(null);
      await invalidatePhotos();
    }
  });

  useEffect(() => {
    const target = dialog === "upload" ? uploadDialogRef.current : dialog === "manage" ? managerDialogRef.current : null;
    for (const element of [uploadDialogRef.current, managerDialogRef.current]) {
      if (element && element !== target && element.open) element.close();
    }
    if (target && !target.open) target.showModal();
  }, [dialog]);

  useEffect(() => {
    if (selectedPhotoId && facadePhotos.some((photo) => photo.id === selectedPhotoId)) return;
    setSelectedPhotoId(facadePhotos[0]?.id ?? null);
  }, [facadePhotos, selectedPhotoId]);

  const openUpload = () => {
    setLocalError("");
    setDialog("upload");
  };

  const openManager = () => {
    setLocalError("");
    setDialog("manage");
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>, setFiles: (files: File[]) => void) => {
    const files = Array.from(event.target.files ?? []);
    if (files.some((file) => !file.type.startsWith("image/"))) {
      setLocalError("仅支持图片文件。");
      event.target.value = "";
      return;
    }
    setFiles(files);
    setLocalError("");
  };

  const submitUpload = () => {
    if (!isEditable) return;
    uploadMutation.mutate();
  };

  const removeSelectedPhoto = () => {
    if (!selectedPhoto || !isEditable) return;
    deleteMutation.mutate(selectedPhoto.id);
  };

  const activeError = localError || (uploadMutation.error ? getErrorMessage(uploadMutation.error) : "");

  return (
    <>
      <button
        className={"facade-operation-button upload-photo-button" + (facadePhotos.length ? " has-files" : "")}
        disabled={!isEditable}
        type="button"
        onClick={openUpload}
      >
        <Upload aria-hidden="true" />
        <span>{facadePhotos.length ? "已上传 " + facadePhotos.length + " 张" : "上传照片"}</span>
      </button>
      <button
        className={"facade-operation-button photo-manage-button" + (facadePhotos.length ? " has-files" : "")}
        type="button"
        onClick={openManager}
      >
        <Image aria-hidden="true" />
        <span>照片管理</span>
      </button>

      {createPortal(
        <>
          <dialog
            ref={uploadDialogRef}
            className="project-dialog upload-dialog"
            onCancel={(event) => { event.preventDefault(); setDialog(null); }}
            onClose={() => setDialog((current) => current === "upload" ? null : current)}
          >
            <form onSubmit={(event) => { event.preventDefault(); submitUpload(); }}>
              <div className="dialog-heading">
                <div><h2>{facade.name || "未命名立面"}</h2></div>
                <button aria-label="关闭" className="icon-button" type="button" onClick={() => setDialog(null)}><X aria-hidden="true" /></button>
              </div>
              <label className="upload-model-field">
                无人机型号
                <select value={droneModel} onChange={(event) => { setDroneModel(event.target.value as DroneModel); setLocalError(""); }}>
                  <option value="dji">大疆型号</option>
                  <option value="other">其他型号</option>
                </select>
              </label>

              {droneModel === "dji" ? (
                <div className="upload-section">
                  <label className="upload-dropzone">
                    <Images aria-hidden="true" />
                    <strong>上传无人机照片</strong>
                    <span>无需区分可见光与热成像，支持多选</span>
                    <em>{formatFileSummary(djiFiles)}</em>
                    <input className="sr-only" accept="image/*" multiple type="file" onChange={(event) => selectFiles(event, setDjiFiles)} />
                  </label>
                </div>
              ) : (
                <div className="split-upload-section">
                  <div>
                    <span className="upload-type-label">可见光图片<b>*</b></span>
                    <label className="upload-dropzone compact">
                      <Image aria-hidden="true" />
                      <strong>上传可见光图片</strong>
                      <em>{formatFileSummary(visibleFiles)}</em>
                      <input className="sr-only" accept="image/*" multiple type="file" onChange={(event) => selectFiles(event, setVisibleFiles)} />
                    </label>
                  </div>
                  <div>
                    <span className="upload-type-label">热成像图片<b>*</b></span>
                    <label className="upload-dropzone compact">
                      <Image aria-hidden="true" />
                      <strong>上传热成像图片</strong>
                      <em>{formatFileSummary(thermalFiles)}</em>
                      <input className="sr-only" accept="image/*" multiple type="file" onChange={(event) => selectFiles(event, setThermalFiles)} />
                    </label>
                  </div>
                </div>
              )}

              {activeError ? <p className="detail-feedback error">{activeError}</p> : null}
              <div className="dialog-actions">
                <button className="button secondary" type="button" onClick={() => setDialog(null)}>取消</button>
                <button className="button primary" disabled={uploadMutation.isPending || !isEditable} type="submit"><UploadCloud aria-hidden="true" />{uploadMutation.isPending ? "上传中" : "确认上传"}</button>
              </div>
            </form>
          </dialog>

          <dialog
            ref={managerDialogRef}
            className="project-dialog photo-manage-dialog"
            onCancel={(event) => { event.preventDefault(); setDialog(null); }}
            onClose={() => setDialog((current) => current === "manage" ? null : current)}
          >
            <div className="dialog-heading">
              <div><h2>{facade.name || "未命名立面"} · 照片管理</h2></div>
              <button aria-label="关闭" className="icon-button" type="button" onClick={() => setDialog(null)}><X aria-hidden="true" /></button>
            </div>
            <div className="photo-manager-layout">
              <aside className="photo-list-panel" aria-label="照片文件名称列表">
                <div className="photo-panel-title">照片文件名称</div>
                <div className="photo-file-list">
                  {facadePhotos.length ? facadePhotos.map((photo) => (
                    <button aria-pressed={photo.id === selectedPhoto?.id} className="photo-file-item" key={photo.id} type="button" onClick={() => setSelectedPhotoId(photo.id)}><span>{photo.original_filename}</span></button>
                  )) : <div className="photo-file-empty">暂无照片文件</div>}
                </div>
              </aside>
              <section className="photo-preview-panel" aria-live="polite">
                {selectedPhoto?.preview_url || selectedPhoto?.thumbnail_url ? <img alt={selectedPhoto.original_filename} className="photo-preview-image" src={selectedPhoto.preview_url ?? selectedPhoto.thumbnail_url ?? ""} /> : <div className="photo-preview-empty"><ImageOff aria-hidden="true" /><span>{selectedPhoto ? "该记录暂无可预览图片" : "暂无可预览图片"}</span></div>}
              </section>
            </div>
            {deleteMutation.isError ? <p className="detail-feedback error">{getErrorMessage(deleteMutation.error)}</p> : null}
            <div className="dialog-actions">
              <button className="button secondary" type="button" onClick={() => setDialog(null)}>关闭</button>
              <button className="button secondary danger-action" disabled={!isEditable || !selectedPhoto || deleteMutation.isPending} type="button" onClick={removeSelectedPhoto}><Trash2 aria-hidden="true" />{deleteMutation.isPending ? "删除中" : "删除"}</button>
            </div>
          </dialog>
        </>,
        document.body
      )}
    </>
  );
}
