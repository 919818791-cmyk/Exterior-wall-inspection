import {
  LayoutDashboard,
  ChartNoAxesCombined,
  Boxes,
  FileText,
  Gauge,
  Images,
  LogOut,
  Plus,
  ScanSearch,
  Settings,
  Sparkles,
  Users,
  UserRound
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";

import type { AuthUser } from "@/types/auth";

interface AppSidebarProps {
  canAccessAdmin: boolean;
  canAccessReview: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onPersonalInfo: () => void;
  onAddQuota: () => void;
  quotaItems: ReadonlyArray<{ label: string; value: string; balance?: { remaining: number; limit: number } }>;
  quotaLabel: string;
  user: AuthUser | null;
}

interface AppSidebarUserMenuContentProps {
  canAccessAdmin: boolean;
  onAddQuota: () => void;
  onLogout: () => void;
  onPersonalInfo: () => void;
  quotaItems: ReadonlyArray<{ label: string; value: string; balance?: { remaining: number; limit: number } }>;
  quotaLabel: string;
}

export function AppSidebarUserMenuContent({
  canAccessAdmin,
  onAddQuota,
  onLogout,
  onPersonalInfo,
  quotaItems,
  quotaLabel
}: AppSidebarUserMenuContentProps) {
  return (
    <div className="app-sidebar-user-expanded">
      {quotaItems.length ? (
        <>
          <div className="app-sidebar-quota-panel">
            <div className="app-sidebar-user-row app-sidebar-user-quota-title">
              <Gauge aria-hidden="true" />
              <span>{quotaLabel}</span>
            </div>
            {quotaItems.map((item) => {
              const percent = item.balance && item.balance.limit > 0
                ? Math.min(100, Math.max(0, item.balance.remaining / item.balance.limit * 100))
                : 0;
              return (
                <div className="app-sidebar-quota-line" key={item.label}>
                  <div aria-label={`${item.label}照片检测额度 ${item.value}`} className="app-sidebar-user-quota-value">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <div
                    aria-label={`${item.label}剩余照片检测额度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.balance ? percent : undefined}
                    aria-valuetext={item.value}
                    className="app-sidebar-quota-progress"
                    role="progressbar"
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {canAccessAdmin ? <button className="app-sidebar-user-row app-sidebar-user-action" type="button" onClick={onAddQuota}>
            <Plus aria-hidden="true" />
            <span>添加额度</span>
          </button> : null}
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
  canAccessAdmin,
  canAccessReview,
  onLogin,
  onLogout,
  onPersonalInfo,
  onAddQuota,
  quotaItems,
  quotaLabel,
  user
}: AppSidebarProps) {
  return (
    <aside aria-label="应用导航" className="app-sidebar">
      <div className="app-sidebar-brand-row">
        <Link aria-label="外墙智能巡检平台首页" className="app-sidebar-brand" title="外墙智能巡检平台" to="/">
          <span className="app-sidebar-brand-symbol"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V6l8-3v18M12 10h8v11M2 21h20M8 8h1m-1 4h1m-1 4h1m7-2h1m-1 3h1" /></svg></span>
          <span className="app-sidebar-label app-sidebar-brand-name">外墙智能巡检平台</span>
        </Link>
      </div>

      <nav aria-label="功能菜单" className="app-sidebar-menu">
        <div className="app-sidebar-menu-section">检测服务</div>
        <NavLink aria-label="专业检测" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="专业检测" to="/detections">
          <ScanSearch aria-hidden="true" />
          <span className="app-sidebar-label">专业检测</span>
        </NavLink>
        <NavLink aria-label="快速体验" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="快速体验" to="/trials">
          <Sparkles aria-hidden="true" />
          <span className="app-sidebar-label">快速体验</span>
        </NavLink>
        {user ? <NavLink aria-label="照片管理" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="照片管理" to="/photos">
          <Images aria-hidden="true" />
          <span className="app-sidebar-label">照片管理</span>
        </NavLink> : null}
        {canAccessReview || canAccessAdmin ? <div className="app-sidebar-menu-section is-management">管理工作台</div> : null}
        {canAccessReview ? (
          <NavLink aria-label="工作台" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="工作台" to="/review">
            <LayoutDashboard aria-hidden="true" />
            <span className="app-sidebar-label">工作台</span>
          </NavLink>
        ) : null}
        {canAccessAdmin ? (
          <>
            <NavLink aria-label="识别质量" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="识别质量" to="/recognition-quality">
              <ChartNoAxesCombined aria-hidden="true" />
              <span className="app-sidebar-label">识别质量</span>
            </NavLink>
            <NavLink aria-label="账号管理" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="账号管理" to="/accounts">
              <Users aria-hidden="true" />
              <span className="app-sidebar-label">账号管理</span>
            </NavLink>
            <NavLink aria-label="推理设置" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="推理设置" to="/system-settings">
              <Settings aria-hidden="true" />
              <span className="app-sidebar-label">推理设置</span>
            </NavLink>
            <NavLink aria-label="检测策略" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="检测策略" to="/detection-prompts">
              <FileText aria-hidden="true" />
              <span className="app-sidebar-label">检测策略</span>
            </NavLink>
            <NavLink aria-label="模型管理" className={({ isActive }) => `app-sidebar-menu-item${isActive ? " is-active" : ""}`} title="模型管理" to="/model-management">
              <Boxes aria-hidden="true" />
              <span className="app-sidebar-label">模型管理</span>
            </NavLink>
          </>
        ) : null}
      </nav>

      <section aria-label="用户模块" className="app-sidebar-user">
        {user ? (
          <AppSidebarUserMenuContent
            canAccessAdmin={canAccessAdmin}
            onAddQuota={onAddQuota}
            onLogout={onLogout}
            onPersonalInfo={onPersonalInfo}
            quotaItems={quotaItems}
            quotaLabel={quotaLabel}
          />
        ) : (
          <button aria-label="登录" className="nav-cta auth-trigger app-sidebar-login" title="登录" type="button" onClick={onLogin}>
            <UserRound aria-hidden="true" />
            <span className="app-sidebar-label">登录</span>
          </button>
        )}
      </section>
    </aside>
  );
}
