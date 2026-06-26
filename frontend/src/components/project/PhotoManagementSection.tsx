import {
  Button,
  Card,
  CardBody,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  useDisclosure
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageUp, Plus, Trash2 } from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";

import {
  createUploadBatch,
  deletePhoto,
  projectPhotosQueryOptions,
  uploadPhoto
} from "@/api/projects";
import type {
  Building,
  Facade,
  Photo,
  PhotoType,
  ProjectDetail,
  UploadMode
} from "@/types/projects";
import { formatDateTime } from "@/utils/projectDisplay";

const PHOTO_TYPE_LABELS: Record<PhotoType, string> = {
  visible: "可见光",
  thermal: "热成像",
  dji: "大疆照片",
  other: "其他"
};

const UPLOAD_MODE_LABELS: Record<UploadMode, string> = {
  dji: "大疆照片",
  visible: "可见光照片",
  thermal: "热成像照片",
  mixed: "混合上传"
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function buildingName(project: ProjectDetail, buildingId: string | null) {
  if (!buildingId) return "-";
  return project.buildings.find((building) => building.id === buildingId)?.name ?? "-";
}

function facadeName(project: ProjectDetail, facadeId: string | null) {
  if (!facadeId) return "-";
  for (const building of project.buildings) {
    const facade = building.facades.find((item) => item.id === facadeId);
    if (facade) return facade.name;
  }
  return "-";
}

function facadesForBuilding(buildings: Building[], buildingId: string) {
  return buildings.find((building) => building.id === buildingId)?.facades ?? [];
}

export function PhotoManagementSection({
  project,
  isEditable
}: {
  project: ProjectDetail;
  isEditable: boolean;
}) {
  const uploadModal = useDisclosure();
  const managerModal = useDisclosure();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const photosQuery = useQuery(projectPhotosQueryOptions(project.id));
  const photos = photosQuery.data ?? [];

  const firstBuildingId = project.buildings[0]?.id ?? "";
  const firstFacadeId = project.buildings[0]?.facades[0]?.id ?? "";
  const [buildingId, setBuildingId] = useState(firstBuildingId);
  const [facadeId, setFacadeId] = useState(firstFacadeId);
  const [uploadMode, setUploadMode] = useState<UploadMode>("visible");
  const [photoType, setPhotoType] = useState<PhotoType>("visible");
  const [droneType, setDroneType] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState("");

  const selectedFacades = useMemo(
    () => facadesForBuilding(project.buildings, buildingId),
    [buildingId, project.buildings]
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["projects", project.id, "photos"] })
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!files.length) throw new Error("请先选择照片。");
      if (!buildingId || !facadeId) throw new Error("请先选择建筑和立面。");

      const batch = await createUploadBatch(project.id, {
        building_id: buildingId,
        facade_id: facadeId,
        drone_type: droneType.trim() || null,
        upload_mode: uploadMode,
        remark: null
      });

      for (const file of files) {
        const formData = new FormData();
        formData.append("project_id", project.id);
        formData.append("upload_batch_id", batch.id);
        formData.append("building_id", buildingId);
        formData.append("facade_id", facadeId);
        formData.append("photo_type", photoType);
        formData.append("file", file);
        await uploadPhoto(formData);
      }
    },
    onSuccess: async () => {
      setFiles([]);
      setLocalError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      uploadModal.onClose();
      await invalidate();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: invalidate
  });

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const imageFiles = selected.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length !== selected.length) {
      setLocalError("仅支持图片文件。");
      return;
    }
    setFiles(imageFiles);
    setLocalError("");
  };

  const handleBuildingChange = (value: string) => {
    const building = project.buildings.find((item) => item.id === value);
    setBuildingId(value);
    setFacadeId(building?.facades[0]?.id ?? "");
  };

  const startUpload = () => {
    if (!isEditable) return;
    uploadMutation.mutate();
  };

  const confirmDelete = (photo: Photo) => {
    if (!isEditable) return;
    const confirmed = window.confirm(`确认删除照片“${photo.original_filename}”？`);
    if (!confirmed) return;
    deleteMutation.mutate(photo.id);
  };

  const latestPhotos = photos.slice(0, 6);
  const activeError = localError || getErrorMessage(uploadMutation.error ?? deleteMutation.error);

  return (
    <Card className="rounded-lg border border-slate-200 shadow-none">
      <CardBody className="gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-ink">照片上传与照片管理</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              按建筑和立面归档照片，文件保存到 MinIO，数据库只保存对象路径。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              startContent={<Camera className="h-4 w-4" aria-hidden="true" />}
              variant="flat"
              onPress={managerModal.onOpen}
            >
              照片管理
            </Button>
            <Button
              className="rounded-lg font-bold"
              color="primary"
              isDisabled={!isEditable || !project.buildings.length}
              startContent={<ImageUp className="h-4 w-4" aria-hidden="true" />}
              onPress={uploadModal.onOpen}
            >
              上传照片
            </Button>
          </div>
        </div>

        {photosQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : photos.length ? (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {latestPhotos.map((photo) => (
              <PhotoTile key={photo.id} photo={photo} project={project} compact />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center">
            <p className="font-bold text-slate-500">
              {project.buildings.length ? "暂无照片。" : "请先维护建筑和立面后再上传照片。"}
            </p>
          </div>
        )}

        <Modal isOpen={uploadModal.isOpen} placement="center" size="3xl" onOpenChange={uploadModal.onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex-col items-start gap-1">
                  <span>上传照片</span>
                  <span className="text-xs font-bold text-slate-500">
                    当前项目为待检测状态时可上传。
                  </span>
                </ModalHeader>
                <ModalBody className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldSelect
                      label="建筑"
                      value={buildingId}
                      onChange={handleBuildingChange}
                      options={project.buildings.map((building) => ({
                        label: building.name,
                        value: building.id
                      }))}
                    />
                    <FieldSelect
                      label="立面"
                      value={facadeId}
                      onChange={setFacadeId}
                      options={selectedFacades.map((facade: Facade) => ({
                        label: facade.name,
                        value: facade.id
                      }))}
                    />
                    <FieldSelect
                      label="上传模式"
                      value={uploadMode}
                      onChange={(value) => setUploadMode(value as UploadMode)}
                      options={Object.entries(UPLOAD_MODE_LABELS).map(([value, label]) => ({
                        label,
                        value
                      }))}
                    />
                    <FieldSelect
                      label="照片类型"
                      value={photoType}
                      onChange={(value) => setPhotoType(value as PhotoType)}
                      options={Object.entries(PHOTO_TYPE_LABELS).map(([value, label]) => ({
                        label,
                        value
                      }))}
                    />
                    <Input
                      classNames={{ inputWrapper: "rounded-lg shadow-none" }}
                      label="无人机型号"
                      value={droneType}
                      onValueChange={setDroneType}
                    />
                  </div>

                  <label className="grid min-h-40 cursor-pointer place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:border-action hover:bg-blue-50">
                    <ImageUp className="h-9 w-9 text-action" aria-hidden="true" />
                    <strong className="mt-2 text-sm text-ink">选择照片</strong>
                    <span className="mt-1 text-xs font-bold text-slate-500">
                      {files.length ? `已选择 ${files.length} 张` : "支持多选 JPG、PNG、WebP 等图片"}
                    </span>
                    <input
                      ref={fileInputRef}
                      className="sr-only"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFiles}
                    />
                  </label>

                  {files.length ? (
                    <div className="grid max-h-40 gap-2 overflow-auto">
                      {files.map((file) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="flex justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate font-bold text-slate-700">{file.name}</span>
                          <span className="shrink-0 text-xs font-semibold text-slate-500">
                            {formatBytes(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {(localError || uploadMutation.isError) ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                      {localError || getErrorMessage(uploadMutation.error)}
                    </div>
                  ) : null}
                </ModalBody>
                <ModalFooter>
                  <Button className="rounded-lg font-bold" variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    className="rounded-lg font-bold"
                    color="primary"
                    isLoading={uploadMutation.isPending}
                    onPress={startUpload}
                  >
                    开始上传
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        <Modal isOpen={managerModal.isOpen} scrollBehavior="inside" size="5xl" onOpenChange={managerModal.onOpenChange}>
          <ModalContent>
            <ModalHeader className="flex-col items-start gap-1">
              <span>照片管理</span>
              <span className="text-xs font-bold text-slate-500">
                非待检测状态可以查看照片，但删除按钮禁用。
              </span>
            </ModalHeader>
            <ModalBody>
              {deleteMutation.isError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                  {getErrorMessage(deleteMutation.error)}
                </div>
              ) : null}
              {photos.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {photos.map((photo) => (
                    <PhotoTile
                      key={photo.id}
                      photo={photo}
                      project={project}
                      canDelete={isEditable}
                      isDeleting={deleteMutation.isPending}
                      onDelete={() => confirmDelete(photo)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="font-bold text-slate-500">暂无照片。</p>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button className="rounded-lg font-bold" variant="light" onPress={managerModal.onClose}>
                关闭
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {(photosQuery.isError || deleteMutation.isError) && !managerModal.isOpen ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {activeError}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold text-slate-600">{label}</span>
      <select
        className="h-12 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-action"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PhotoTile({
  photo,
  project,
  compact = false,
  canDelete = false,
  isDeleting = false,
  onDelete
}: {
  photo: Photo;
  project: ProjectDetail;
  compact?: boolean;
  canDelete?: boolean;
  isDeleting?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="aspect-[4/3] bg-slate-100">
        {photo.thumbnail_url ? (
          <img
            alt={photo.original_filename}
            className="h-full w-full object-cover"
            src={photo.thumbnail_url}
          />
        ) : (
          <div className="grid h-full place-items-center text-slate-400">
            <Camera className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="grid gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-ink">{photo.original_filename}</p>
          {!compact ? (
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {buildingName(project, photo.building_id)} / {facadeName(project, photo.facade_id)}
            </p>
          ) : null}
        </div>
        {!compact ? (
          <>
            <Divider />
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="font-bold text-slate-500">类型</dt>
                <dd className="mt-1 font-black text-slate-700">{PHOTO_TYPE_LABELS[photo.photo_type]}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">大小</dt>
                <dd className="mt-1 font-black text-slate-700">{formatBytes(photo.file_size)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="font-bold text-slate-500">上传时间</dt>
                <dd className="mt-1 font-black text-slate-700">{formatDateTime(photo.created_at)}</dd>
              </div>
            </dl>
            <Button
              className="rounded-lg border border-red-200 bg-white font-bold text-red-600 shadow-none disabled:opacity-40"
              isDisabled={!canDelete}
              isLoading={isDeleting}
              size="sm"
              startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              variant="flat"
              onPress={onDelete}
            >
              删除照片
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
