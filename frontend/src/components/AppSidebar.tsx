import {
  BriefcaseBusiness,
  Gauge,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  Settings,
  Sparkles,
  Tags,
  Users,
  UserRound
} from "lucide-react";
import { type ReactNode, type RefObject } from "react";
import { Link, NavLink } from "react-router-dom";

import type { AuthUser } from "@/types/auth";

interface AppSidebarProps {
  accountMenu: ReactNode;
  accountMenuOpen: boolean;
  accountMenuRef: RefObject<HTMLElement>;
  canAccessAdmin: boolean;
  canAccessReview: boolean;
  canToggle: boolean;
  collapsed: boolean;
  onCollapsedChange: () => void;
  onAccountMenuToggle: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onPersonalInfo: () => void;
  quotaItems: ReadonlyArray<{ label: string; value: string }>;
  quotaLabel: string;
  user: AuthUser | null;
}

interface AppSidebarUserMenuContentProps {
  onLogout: () => void;
  onPersonalInfo: () => void;
  quotaItems: ReadonlyArray<{ label: string; value: string }>;
  quotaLabel: string;
}

export function AppSidebarUserMenuContent({
  onLogout,
  onPersonalInfo,
  quotaItems,
  quotaLabel
}: AppSidebarUserMenuContentProps) {
  return (
    <div className="app-sidebar-user-expanded">
      {quotaItems.length ? (
        <>
          <div className="app-sidebar-user-row app-sidebar-user-quota-title">
            <Gauge aria-hidden="true" />
            <span>{quotaLabel}</span>
          </div>
          {quotaItems.map((item) => (
            <div aria-label={`${item.label}照片检测额度 ${item.value}`} className="app-sidebar-user-quota-value" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </>
      ) : null}
      <button className="app-sidebar-user-row app-sidebar-user-action" type="button" onClick={onPersonalInfo}>
        <UserRound aria-hidden="true" />
        <span>个人信息</span>
      </button>
      <button className="app-sidebar-user-row app-sidebar-user-action" type="button" onClick={onLogout}>
        <LogOut aria-hidden="true" />
        <span>退出登录</span>
      </button>
    </div>
  );
}

export function AppSidebar({
  accountMenu,
  accountMenuOpen,
  accountMenuRef,
  canAccessAdmin,
  canAccessReview,
  canToggle,
  collapsed,
  onCollapsedChange,
  onAccountMenuToggle,
  onLogin,
  onLogout,
  onPersonalInfo,
  quotaItems,
  quotaLabel,
  user
}: AppSidebarProps) {
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
        <NavLink aria-label="定价" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="定价" to="/pricing">
          <Tags aria-hidden="true" />
          <span className="app-sidebar-label">定价</span>
        </NavLink>
        {canAccessReview ? (
          <NavLink aria-label="工作台" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="工作台" to="/review">
            <BriefcaseBusiness aria-hidden="true" />
            <span className="app-sidebar-label">工作台</span>
          </NavLink>
        ) : null}
        {canAccessAdmin ? (
          <>
            <NavLink aria-label="账号管理" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="账号管理" to="/accounts">
              <Users aria-hidden="true" />
              <span className="app-sidebar-label">账号管理</span>
            </NavLink>
            <NavLink aria-label="推理设置" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="推理设置" to="/system-settings">
              <Settings aria-hidden="true" />
              <span className="app-sidebar-label">推理设置</span>
            </NavLink>
          </>
        ) : null}
      </nav>

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
          <AppSidebarUserMenuContent
            onLogout={onLogout}
            onPersonalInfo={onPersonalInfo}
            quotaItems={quotaItems}
            quotaLabel={quotaLabel}
          />
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
