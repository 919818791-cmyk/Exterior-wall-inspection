import {
  Card,
  CardBody,
  Skeleton
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  ImagePlus,
  ScanSearch
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link as RouterLink,
  useLocation,
  useOutletContext,
  useParams
} from "react-router-dom";

import {
  projectPhotosQueryOptions,
  projectQueryOptions,
  startDetection
} from "@/api/projects";
import { ProjectPhotoActions } from "@/components/project/ProjectPhotoActions";
import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";
import { StartDetectionModal } from "@/components/project/StartDetectionModal";
import { WorkspaceTitleBar } from "@/components/WorkspaceTitleBar";
import { useAuthStore } from "@/stores/useAuthStore";
import type { StartDetectionPayload } from "@/types/projects";
import { MAX_PROJECT_PHOTO_COUNT } from "@/utils/photoUpload";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const outletContext = useOutletContext<{
    setProjectDetailListChrome: (enabled: boolean) => void;
  } | undefined>();
  const setProjectDetailListChrome = outletContext?.setProjectDetailListChrome;
  const projectQuery = useQuery(projectQueryOptions(id));
  const projectPhotosQuery = useQuery(projectPhotosQueryOptions(id));
  const project = projectQuery.data;
  const projectNavigationState = location.state as {
    openDetectionModal?: boolean;
  } | null;
  const [detectionModalOpen, setDetectionModalOpen] = useState(
    projectNavigationState?.openDetectionModal ?? false
  );
  const photoInputId = `project-detail-photo-input-${id}`;

  useEffect(() => {
    if (!setProjectDetailListChrome) return undefined;
    setProjectDetailListChrome(true);
    return () => setProjectDetailListChrome(false);
  }, [setProjectDetailListChrome]);

  const startDetectionMutation = useMutation({
    mutationFn: (payload: StartDetectionPayload) => startDetection(id, payload),
    onSuccess: async () => {
      setDetectionModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id] }),
        queryClient.invalidateQueries({ queryKey: ["projects", id, "photos"] })
      ]);
    }
  });

  if (projectQuery.isLoading) {
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <WorkspaceTitleBar
          backLabel="返回专业检测"
          backTo="/detections"
          className="project-detail-title-bar"
          title="正在加载项目"
        />
        <div className="create-workspace grid gap-5">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </ProjectWorkbenchShell>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <ProjectWorkbenchShell actionLabel="返回" hideHeader>
        <WorkspaceTitleBar
          backLabel="返回专业检测"
          backTo="/detections"
          className="project-detail-title-bar"
          title="项目详情"
        />
        <div className="create-workspace grid min-h-[calc(100svh-12rem)] place-items-center">
          <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
            <CardBody className="gap-4 p-6">
              <h2 className="text-xl font-black text-ink">项目加载失败</h2>
              <p className="text-sm font-bold text-red-700">
                {getErrorMessage(projectQuery.error)}
              </p>
            </CardBody>
          </Card>
        </div>
      </ProjectWorkbenchShell>
    );
  }

  const photos = projectPhotosQuery.data ?? [];
  const qualifiedPhotos = photos.filter((photo) => photo.precheck_status === "passed");
  const rejectedPhotoCount = photos.filter((photo) => photo.precheck_status === "rejected").length;
  const nonDronePhotoCount = photos.filter((photo) => (
    photo.precheck_status === "rejected" && photo.precheck_category === "NON_DRONE"
  )).length;
  const thermalPhotoCount = qualifiedPhotos.filter((photo) => photo.photo_type === "thermal").length;
  const canManageProject = user?.role === "admin" || project.created_by === user?.id;
  const isEditable = Boolean(canManageProject && project.status === "draft");
  const hasResult = (project.status === "reviewed" || project.status === "completed")
    && Boolean(project.current_report_id);
  const canAddPhoto = isEditable && photos.length < MAX_PROJECT_PHOTO_COUNT;
  const primaryActionLabel = project.status === "draft" ? "开始检测" : "检测中";
  const detailActions = hasResult && project.current_report_id ? (
    <RouterLink className="button primary-action-button" to={`/detections/results/${project.current_report_id}`}>
      <FileText aria-hidden="true" />
      <span className="workspace-title-bar-action-label">查看结果</span>
    </RouterLink>
  ) : (
    <>
      <button
        className="button primary-action-button start-ai-detection-button"
        disabled={!isEditable || startDetectionMutation.isPending}
        type="button"
        onClick={() => setDetectionModalOpen(true)}
      >
        <ScanSearch aria-hidden="true" />
        <span className="workspace-title-bar-action-label">
          {startDetectionMutation.isPending ? "检测中" : primaryActionLabel}
        </span>
      </button>
      {project.status === "draft" ? (
        <button
          aria-controls={photoInputId}
          className="button secondary project-detail-add-photo-button"
          disabled={!canAddPhoto}
          type="button"
          onClick={() => document.getElementById(photoInputId)?.click()}
        >
          <ImagePlus aria-hidden="true" />
          <span className="workspace-title-bar-action-label">继续添加照片</span>
        </button>
      ) : null}
    </>
  );
  const activeError = startDetectionMutation.error;

  return (
    <ProjectWorkbenchShell actionLabel="返回" hideHeader>
      <WorkspaceTitleBar
        actions={detailActions}
        backLabel="返回专业检测"
        backTo="/detections"
        className="project-detail-title-bar"
        title={project.name || project.project_no}
      />
      {activeError ? (
        <p className="project-list-error">{getErrorMessage(activeError)}</p>
      ) : null}
      <div className="trial-experience-shell trial-experience-content-shell trial-result-detail-shell project-detail-content-shell">
        <section className="trial-experience-grid">
          <aside className="trial-report-panel">
            <div className="trial-report-result is-headless">
              <ProjectPhotoActions
                inputId={photoInputId}
                isEditable={isEditable}
                project={project}
              />
            </div>
          </aside>
        </section>
      </div>
      <StartDetectionModal
        error={activeError}
        isProfessional
        isOpen={detectionModalOpen}
        isPending={startDetectionMutation.isPending}
        nonDronePhotoCount={nonDronePhotoCount}
        qualifiedPhotoCount={qualifiedPhotos.length}
        rejectedPhotoCount={rejectedPhotoCount}
        thermalPhotoCount={thermalPhotoCount}
        onOpenChange={setDetectionModalOpen}
        onSubmit={(payload) => startDetectionMutation.mutate(payload)}
      />
    </ProjectWorkbenchShell>
  );
}
