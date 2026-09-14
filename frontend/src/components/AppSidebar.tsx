import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Gauge,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  Sparkles,
  UserRound
} from "lucide-react";
import { useMemo, type ReactNode, type RefObject } from "react";
import { Link, NavLink } from "react-router-dom";

import { projectsQueryOptions } from "@/api/projects";
import { reportsQueryOptions } from "@/api/reports";
import type { AuthUser } from "@/types/auth";

const RECENT_PROJECT_LIMIT = 6;

interface AppSidebarProps {
  accountMenu: ReactNode;
  accountMenuOpen: boolean;
  accountMenuRef: RefObject<HTMLElement>;
  canAccessReview: boolean;
  canToggle: boolean;
  collapsed: boolean;
  onCollapsedChange: () => void;
  onAccountMenuToggle: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onPersonalInfo: () => void;
  quotaValueLabel: string;
  quotaLabel: string;
  quotaPeriodLabel: string;
  user: AuthUser | null;
}

export function AppSidebar({
  accountMenu,
  accountMenuOpen,
  accountMenuRef,
  canAccessReview,
  canToggle,
  collapsed,
  onCollapsedChange,
  onAccountMenuToggle,
  onLogin,
  onLogout,
  onPersonalInfo,
  quotaValueLabel,
  quotaLabel,
  quotaPeriodLabel,
  user
}: AppSidebarProps) {
  const projectsQuery = useQuery({
    ...projectsQueryOptions(user),
    enabled: Boolean(user) && !collapsed
  });
  const reportsQuery = useQuery({
    ...reportsQueryOptions(user),
    enabled: Boolean(user) && !collapsed
  });
  const recentProjects = useMemo(() => {
    const projects = (projectsQuery.data ?? []).map((project) => ({
      id: project.id,
      isExample: project.is_example,
      name: project.name,
      sourceLabel: "专业检测",
      to: `/detections/${project.id}`,
      updatedAt: project.updated_at
    }));
    const trialReports = (reportsQuery.data ?? [])
      .filter((report) => report.source_type === "trial")
      .map((report) => ({
        id: report.id,
        isExample: report.is_example,
        name: report.title,
        sourceLabel: "快速体验",
        to: `/trials/${report.id}`,
        updatedAt: report.updated_at
      }));
    return [...projects, ...trialReports]
      .sort((left, right) => (
        Number(left.isExample) - Number(right.isExample)
        || right.updatedAt.localeCompare(left.updatedAt)
      ))
      .slice(0, RECENT_PROJECT_LIMIT);
  }, [projectsQuery.data, reportsQuery.data]);
  const recentProjectsLoading = projectsQuery.isLoading || reportsQuery.isLoading;
  const collapseLabel = canToggle
    ? (collapsed ? "展开左侧栏" : "收纳左侧栏")
    : "当前窗口宽度下左侧栏已自动收纳";

  return (
    <aside aria-label="应用导航" className={`app-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="app-sidebar-brand-row">
        <Link aria-label="外墙智能巡检平台首页" className="app-sidebar-brand" title="外墙智能巡检平台" to="/">
          <span className="app-sidebar-label app-sidebar-brand-name">外墙智能巡检平台</span>
        </Link>
        <button
          aria-label={collapseLabel}
          className="app-sidebar-collapse"
          disabled={!canToggle}
          title={collapseLabel}
          type="button"
          onClick={onCollapsedChange}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      <nav aria-label="功能菜单" className="app-sidebar-menu">
        <NavLink aria-label="专业检测" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="专业检测" to="/detections">
          <ScanSearch aria-hidden="true" />
          <span className="app-sidebar-label">专业检测</span>
        </NavLink>
        <NavLink aria-label="快速体验" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="快速体验" to="/trials">
          <Sparkles aria-hidden="true" />
          <span className="app-sidebar-label">快速体验</span>
        </NavLink>
        {canAccessReview ? (
          <NavLink aria-label="工作台" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="工作台" to="/review">
            <BriefcaseBusiness aria-hidden="true" />
            <span className="app-sidebar-label">工作台</span>
          </NavLink>
        ) : null}
      </nav>

      <section aria-label="最近项目" className="app-sidebar-recent">
        <div className="app-sidebar-section-heading">
          <span className="app-sidebar-label">最近</span>
        </div>
        <div className="app-sidebar-project-list">
          {user && recentProjectsLoading ? <span className="app-sidebar-project-state">正在加载…</span> : null}
          {user && !recentProjectsLoading && recentProjects.length === 0 ? (
            <span className="app-sidebar-project-state">暂无最近项目</span>
          ) : null}
          {recentProjects.map((project) => (
            <Link
              aria-label={`打开${project.sourceLabel}项目 ${project.name}`}
              className="app-sidebar-project"
              key={`${project.sourceLabel}-${project.id}`}
              title={`${project.sourceLabel} · ${project.name}`}
              to={project.to}
            >
              <span className="app-sidebar-project-name">{project.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section
        ref={accountMenuRef}
        aria-label="用户模块"
        className={`app-sidebar-user account-menu${accountMenuOpen ? " is-open" : ""}`}
      >
        {user ? (collapsed ? (
          <>
            <button
              aria-controls="sidebar-account-dropdown"
              aria-expanded={accountMenuOpen}
              aria-label="账号与使用量"
              className="app-sidebar-user-trigger"
              title="账号与使用量"
              type="button"
              onClick={onAccountMenuToggle}
            >
              <span aria-hidden="true" className="app-sidebar-user-avatar"><UserRound /></span>
            </button>
            {accountMenu}
          </>
        ) : (
          <div className="app-sidebar-user-expanded">
            <div className="app-sidebar-user-row app-sidebar-user-quota-title">
              <Gauge aria-hidden="true" />
              <span>{quotaLabel}</span>
            </div>
            <div aria-label={`${quotaPeriodLabel}照片上传额度 ${quotaValueLabel}`} className="app-sidebar-user-quota-value">
              <span>{quotaPeriodLabel}</span>
              <strong>{quotaValueLabel}</strong>
            </div>
            <button className="app-sidebar-user-row app-sidebar-user-action" type="button" onClick={onPersonalInfo}>
              <UserRound aria-hidden="true" />
              <span>个人信息</span>
            </button>
            <button className="app-sidebar-user-row app-sidebar-user-action" type="button" onClick={onLogout}>
              <LogOut aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </div>
        )) : (
          <button aria-label="登录" className="nav-cta auth-trigger app-sidebar-login" title="登录" type="button" onClick={onLogin}>
            <UserRound aria-hidden="true" />
            <span className="app-sidebar-label">登录</span>
          </button>
        )}
      </section>
    </aside>
  );
}
