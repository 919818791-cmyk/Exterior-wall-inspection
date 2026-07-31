import { createBrowserRouter, Navigate } from "react-router-dom";

import { RequireAuth, RequireRole } from "@/components/auth/RouteGuards";
import { AppLayout } from "@/layouts/AppLayout";
import { AccountManagementPage } from "@/pages/AccountManagementPage";
import { AnnotationManagementDetailPage } from "@/pages/AnnotationManagementDetailPage";
import { AnnotationManagementPage } from "@/pages/AnnotationManagementPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DataManagementPage } from "@/pages/DataManagementPage";
import { CapabilityDetailPage } from "@/pages/CapabilityDetailPage";
import { PrivacyPolicyPage, TermsPage } from "@/pages/LegalDocumentPage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ReportDetailPage } from "@/pages/ReportDetailPage";
import { ReportListPage } from "@/pages/ReportListPage";
import { ReviewProjectDetailPage } from "@/pages/ReviewProjectDetailPage";
import { ReviewProjectListPage } from "@/pages/ReviewProjectListPage";
import { SystemSettingsPage } from "@/pages/SystemSettingsPage";
import { TrialExperiencePage } from "@/pages/TrialExperiencePage";

export const router = createBrowserRouter([
  { path: "/login", element: <Navigate replace to="/" /> },
  { path: "/privacy", element: <PrivacyPolicyPage /> },
  { path: "/terms", element: <TermsPage /> },
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
          { path: "projects", element: <ProjectListPage /> },
          { path: "projects/new", element: <NewProjectPage /> },
          { path: "projects/:id", element: <ProjectDetailPage /> },
          {
            element: <RequireRole roles={["admin"]} />,
            children: [
              { path: "accounts", element: <AccountManagementPage /> },
              { path: "data-management", element: <DataManagementPage /> },
              { path: "annotation-management", element: <AnnotationManagementPage /> },
              { path: "annotation-management/:id", element: <AnnotationManagementDetailPage /> },
              { path: "system-settings", element: <SystemSettingsPage /> }
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
