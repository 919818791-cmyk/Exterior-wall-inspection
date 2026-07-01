import { createBrowserRouter, Navigate } from "react-router-dom";

import { RequireAuth, RequireRole } from "@/components/auth/RouteGuards";
import { AppLayout } from "@/layouts/AppLayout";
import { AccountManagementPage } from "@/pages/AccountManagementPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { CapabilityDetailPage } from "@/pages/CapabilityDetailPage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ReportDetailPage } from "@/pages/ReportDetailPage";
import { ReportListPage } from "@/pages/ReportListPage";
import { ReviewProjectDetailPage } from "@/pages/ReviewProjectDetailPage";
import { ReviewProjectListPage } from "@/pages/ReviewProjectListPage";
import { TrialExperiencePage } from "@/pages/TrialExperiencePage";

export const router = createBrowserRouter([
  { path: "/login", element: <Navigate replace to="/" /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "capabilities", element: <Navigate replace to="/capabilities/crack" /> },
      { path: "capabilities/:type", element: <CapabilityDetailPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "trial", element: <TrialExperiencePage /> },
          { path: "reports", element: <ReportListPage /> },
          { path: "reports/:id", element: <ReportDetailPage /> },
          {
            element: <RequireRole roles={["admin"]} />,
            children: [
              { path: "projects", element: <ProjectListPage /> },
              { path: "projects/new", element: <NewProjectPage /> },
              { path: "projects/:id", element: <ProjectDetailPage /> },
              { path: "accounts", element: <AccountManagementPage /> }
            ]
          },
          {
            element: <RequireRole roles={["reviewer", "admin"]} />,
            children: [
              { path: "review", element: <ReviewProjectListPage /> },
              { path: "review/projects/:id", element: <ReviewProjectDetailPage /> }
            ]
          }
        ]
      }
    ]
  }
]);
