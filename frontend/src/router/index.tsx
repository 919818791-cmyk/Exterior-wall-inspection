import { createBrowserRouter } from "react-router-dom";

import { RequireAuth, RequireRole } from "@/components/auth/RouteGuards";
import { AppLayout } from "@/layouts/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ReportDetailPage } from "@/pages/ReportDetailPage";
import { ReportListPage } from "@/pages/ReportListPage";
import { ReviewProjectDetailPage } from "@/pages/ReviewProjectDetailPage";
import { ReviewProjectListPage } from "@/pages/ReviewProjectListPage";
import { TrialExperiencePage } from "@/pages/TrialExperiencePage";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />
  },
  {
    path: "/",
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <DashboardPage />
          },
          {
            path: "capabilities",
            element: (
              <PlaceholderPage
                title="AI检测能力"
                description="裂缝、剥落、空鼓、渗漏、锈蚀能力页将在后续阶段承接原型内容。"
                status="route-reserved"
              />
            )
          },
          {
            path: "capabilities/:type",
            element: (
              <PlaceholderPage
                title="检测能力详情"
                description="单项检测能力详情路由已预留。"
                status="route-reserved"
              />
            )
          },
          {
            path: "trial",
            element: <TrialExperiencePage />
          },
          {
            path: "projects",
            element: <ProjectListPage />
          },
          {
            path: "projects/new",
            element: <NewProjectPage />
          },
          {
            path: "projects/:id",
            element: <ProjectDetailPage />
          },
          {
            path: "reports",
            element: <ReportListPage />
          },
          {
            path: "reports/:id",
            element: <ReportDetailPage />
          },
          {
            element: <RequireRole roles={["reviewer", "admin"]} />,
            children: [
              {
                path: "review",
                element: <ReviewProjectListPage />
              },
              {
                path: "review/projects/:id",
                element: <ReviewProjectDetailPage />
              }
            ]
          }
        ]
      }
    ]
  }
]);
