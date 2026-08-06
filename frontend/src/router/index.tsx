import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { RequireAuth, RequireRole } from "@/components/auth/RouteGuards";
import { AppLayout } from "@/layouts/AppLayout";

const AccountManagementPage = lazy(() => import("@/pages/AccountManagementPage").then((module) => ({ default: module.AccountManagementPage })));
const CapabilityDetailPage = lazy(() => import("@/pages/CapabilityDetailPage").then((module) => ({ default: module.CapabilityDetailPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DataManagementPage = lazy(() => import("@/pages/DataManagementPage").then((module) => ({ default: module.DataManagementPage })));
const PrivacyPolicyPage = lazy(() => import("@/pages/LegalDocumentPage").then((module) => ({ default: module.PrivacyPolicyPage })));
const TermsPage = lazy(() => import("@/pages/LegalDocumentPage").then((module) => ({ default: module.TermsPage })));
const NewProjectPage = lazy(() => import("@/pages/NewProjectPage").then((module) => ({ default: module.NewProjectPage })));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetailPage").then((module) => ({ default: module.ProjectDetailPage })));
const ProjectListPage = lazy(() => import("@/pages/ProjectListPage").then((module) => ({ default: module.ProjectListPage })));
const ReportDetailPage = lazy(() => import("@/pages/ReportDetailPage").then((module) => ({ default: module.ReportDetailPage })));
const ReportListPage = lazy(() => import("@/pages/ReportListPage").then((module) => ({ default: module.ReportListPage })));
const ReviewProjectDetailPage = lazy(() => import("@/pages/ReviewProjectDetailPage").then((module) => ({ default: module.ReviewProjectDetailPage })));
const ReviewProjectListPage = lazy(() => import("@/pages/ReviewProjectListPage").then((module) => ({ default: module.ReviewProjectListPage })));
const SystemSettingsPage = lazy(() => import("@/pages/SystemSettingsPage").then((module) => ({ default: module.SystemSettingsPage })));
const TrialExperiencePage = lazy(() => import("@/pages/TrialExperiencePage").then((module) => ({ default: module.TrialExperiencePage })));

function deferred(element: ReactElement) {
  return (
    <Suspense fallback={<main aria-label="正在加载页面内容" className="route-content-loader"><span /></main>}>
      {element}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <Navigate replace to="/" /> },
  { path: "/privacy", element: deferred(<PrivacyPolicyPage />) },
  { path: "/terms", element: deferred(<TermsPage />) },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: deferred(<DashboardPage />) },
      { path: "capabilities", element: <Navigate replace to="/capabilities/crack" /> },
      { path: "capabilities/:type", element: deferred(<CapabilityDetailPage />) },
      {
        element: <RequireAuth />,
        children: [
          { path: "trial", element: deferred(<TrialExperiencePage />) },
          { path: "reports", element: deferred(<ReportListPage />) },
          { path: "reports/:id", element: deferred(<ReportDetailPage />) },
          { path: "projects", element: deferred(<ProjectListPage />) },
          { path: "projects/new", element: deferred(<NewProjectPage />) },
          { path: "projects/:id", element: deferred(<ProjectDetailPage />) },
          {
            element: <RequireRole roles={["admin"]} />,
            children: [
              { path: "accounts", element: deferred(<AccountManagementPage />) },
              { path: "data-management", element: deferred(<DataManagementPage />) },
              { path: "system-settings", element: deferred(<SystemSettingsPage />) }
            ]
          },
          {
            element: <RequireRole roles={["reviewer", "admin"]} />,
            children: [
              { path: "annotation-management/*", element: <Navigate replace to="/review" /> },
              { path: "review", element: deferred(<ReviewProjectListPage />) },
              { path: "review/projects/:id", element: deferred(<ReviewProjectDetailPage />) }
            ]
          }
        ]
      }
    ]
  }
]);
