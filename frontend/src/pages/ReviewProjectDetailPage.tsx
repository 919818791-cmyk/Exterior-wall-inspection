import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, TriangleAlert } from "lucide-react";
import { Link as RouterLink, useParams } from "react-router-dom";

import { reviewDetectionQueryOptions } from "@/api/review";
import { AnnotationResultWorkbench } from "@/pages/AnnotationManagementDetailPage";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "审核详情加载失败，请稍后重试。";
}

export function ReviewProjectDetailPage() {
  const { id = "" } = useParams();
  const detectionQuery = useQuery(reviewDetectionQueryOptions(id));

  if (detectionQuery.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-[560px] rounded-lg" />
      </div>
    );
  }

  if (detectionQuery.isError || !detectionQuery.data) {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-red-200 shadow-none">
          <CardBody className="gap-4 p-6">
            <TriangleAlert className="h-9 w-9 text-red-500" aria-hidden="true" />
            <h1 className="text-xl font-black text-ink">审核详情加载失败</h1>
            <p className="text-sm font-bold text-red-700">
              {errorMessage(detectionQuery.error)}
            </p>
            <Button
              as={RouterLink}
              className="w-fit rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              to="/review"
              variant="flat"
            >
              返回审核工作台
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const detection = detectionQuery.data;
  if (!detection.report_id || detection.review_status === "detecting" || detection.review_status === "failed") {
    return (
      <div className="grid min-h-[calc(100svh-8rem)] place-items-center">
        <Card className="w-full max-w-2xl rounded-lg border border-slate-200 shadow-none">
          <CardBody className="items-center gap-4 p-8 text-center">
            <ClipboardCheck className="h-10 w-10 text-slate-400" aria-hidden="true" />
            <h1 className="text-xl font-black text-ink">
              {detection.review_status === "failed" ? "AI 检测失败" : "检测结果尚未就绪"}
            </h1>
            <p className="text-sm font-bold text-slate-500">
              {detection.project_name}
            </p>
            <Button
              as={RouterLink}
              className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
              to="/review"
              variant="flat"
            >
              返回审核工作台
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <AnnotationResultWorkbench
      backLabel="返回列表"
      backTo="/review"
      pageTitle="审核工作台"
      projectName={detection.project_name}
      resultId={detection.report_id}
      reviewTaskId={detection.id}
      sourceType="formal"
    />
  );
}
