import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";

import { RequireAuth, RequireRole } from "@/components/auth/RouteGuards";
import { AppLayout } from "@/layouts/AppLayout";

const AccountManagementPage = lazy(() => import("@/pages/AccountManagementPage").then((module) => ({ default: module.AccountManagementPage })));
const BuildingModelPage = lazy(() => import("@/pages/BuildingModelPage").then((module) => ({ default: module.BuildingModelPage })));
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

function LegacyDetectionRedirect() {
  const { id = "" } = useParams();
  return <Navigate replace to={`/detections/${id}`} />;
}

function LegacyReviewDetectionRedirect() {
  const { id = "" } = useParams();
  return <Navigate replace to={`/review/detections/${id}`} />;
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
      { path: "capabilities/time", element: <Navigate replace to="/" /> },
      { path: "capabilities/:type", element: deferred(<CapabilityDetailPage />) },
      { path: "trials", element: deferred(<ReportListPage />) },
      { path: "reports", element: <Navigate replace to="/trials" /> },
      { path: "projects", element: <Navigate replace to="/detections" /> },
      { path: "detections", element: deferred(<ProjectListPage />) },
      { path: "detections/:id/model", element: deferred(<BuildingModelPage />) },
      {
        element: <RequireAuth />,
        children: [
          { path: "trials/new", element: deferred(<TrialExperiencePage />) },
          { path: "trials/:id", element: deferred(<ReportDetailPage />) },
          { path: "detections/results/:id", element: deferred(<ReportDetailPage />) },
          { path: "detections/new", element: deferred(<NewProjectPage />) },
          { path: "detections/:id", element: deferred(<ProjectDetailPage />) },
          { path: "trial", element: <Navigate replace to="/trials/new" /> },
          { path: "reports/:id", element: deferred(<ReportDetailPage />) },
          { path: "projects/new", element: <Navigate replace to="/detections/new" /> },
          { path: "projects/:id", element: <LegacyDetectionRedirect /> },
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
              { path: "review/detections/:id", element: deferred(<ReviewProjectDetailPage />) },
              { path: "review/projects/:id", element: <LegacyReviewDetectionRedirect /> }
            ]
          }
        ]
      }
    ]
  }
]);
