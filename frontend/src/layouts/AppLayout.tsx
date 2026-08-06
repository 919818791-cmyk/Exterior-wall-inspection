import { ChevronDown, Gauge, LogOut, Menu, RefreshCw, UserRound, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { currentAccountUsageQueryOptions } from "@/api/accounts";
import { logout } from "@/api/auth";
import { AUTH_UNAUTHORIZED_EVENT } from "@/api/client";
import { AuthModal } from "@/components/auth/AuthModal";
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal";
import { PersonalInfoModal } from "@/components/auth/PersonalInfoModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type { CurrentAccountUsageResponse } from "@/types/accountUsage";

function pageClass(pathname: string) {
  if (pathname === "/trial") return "project-page new-project-page project-list-chrome trial-route";
  if (pathname === "/reports") return "project-page project-list-route report-list-route";
  if (pathname === "/projects") return "project-page project-list-route";
  if (pathname === "/capabilities/time") return "detail-page recommendation-detail-page";
  if (pathname.startsWith("/accounts")) return "project-page account-management-route";
  if (pathname.startsWith("/data-management")) return "project-page data-management-route";
  if (pathname === "/review") return "project-page review-workbench-route review-workbench-list-route";
  if (pathname.startsWith("/review")) return "project-page review-workbench-route";
  if (/^\/reports\/[^/]+$/.test(pathname)) return "project-page report-detail-route";
  if (pathname === "/projects/new") return "project-page new-project-page project-list-chrome";
  if (/^\/projects\/[^/]+$/.test(pathname)) return "project-page project-detail-page";
  if (pathname.startsWith("/projects") || pathname.startsWith("/accounts") || pathname.startsWith("/data-management") || pathname.startsWith("/system-settings") || pathname.startsWith("/reports") || pathname.startsWith("/review")) {
    return "project-page";
  }
  if (pathname.startsWith("/capabilities")) return "detail-page";
  return "";
}

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [personalInfoModalOpen, setPersonalInfoModalOpen] = useState(false);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [managementMenuOpen, setManagementMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [projectDetailListChrome, setProjectDetailListChrome] = useState(false);
  const accountUsageQuery = useQuery({
    ...currentAccountUsageQueryOptions,
    enabled: Boolean(user && accountMenuOpen)
  });
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const managementMenuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pendingAuthenticationActionRef = useRef<(() => void) | null>(null);
  const isTrialRoute = location.pathname === "/trial";
  const defectKey = location.pathname.match(/^\/capabilities\/(crack|spalling|missing|moisture|corrosion|hollow)$/)?.[1];
  const isReviewDetailRoute = /^\/review\/projects\/[^/]+$/.test(location.pathname);
  const isStandaloneManagementRoute = (
    location.pathname === "/system-settings"
    || location.pathname.startsWith("/accounts")
    || location.pathname.startsWith("/data-management")
    || location.pathname === "/review"
    || /^\/reports\/[^/]+$/.test(location.pathname)
  );
  const isProjectRoute = location.pathname.startsWith("/projects");
  const isManagementRoute = location.pathname.startsWith("/accounts") || location.pathname.startsWith("/data-management") || location.pathname.startsWith("/system-settings") || location.pathname.startsWith("/review");
  const isHomeRoute = location.pathname === "/";
  const isReportRoute = location.pathname === "/reports" || location.pathname.startsWith("/reports/");
  const currentPageClass = pageClass(location.pathname);
  const resolvedPageClass = `${currentPageClass}${projectDetailListChrome ? " project-list-chrome" : ""}`;
  const isCapabilityDetailRoute = location.pathname.startsWith("/capabilities");
  const isThemeHeroRoute = isTrialRoute || isReportRoute || isProjectRoute || isManagementRoute;
  const usesPermanentDarkShell = isCapabilityDetailRoute || isThemeHeroRoute;
  const usesDarkShell = usesPermanentDarkShell;
  const canAccessAdmin = user?.role === "admin";
  const canAccessReview = user?.role === "reviewer" || user?.role === "admin";

  useLayoutEffect(() => {
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("login") === "1") setAuthModalOpen(true);
  }, [location.search]);

  useEffect(() => {
    const handleUnauthorized = () => {
      if (!useAuthStore.getState().user) return;
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      clearSession();
      queryClient.clear();
      setAccountMenuOpen(false);
      setPersonalInfoModalOpen(false);
      setChangePasswordModalOpen(false);
      setAuthNotice("登录状态已失效，请重新登录。登录后将返回当前页面。");
      setAuthModalOpen(true);
      navigate(`/?login=1&redirect=${encodeURIComponent(currentPath)}`, { replace: true });
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession, navigate, queryClient]);

  useEffect(() => {
    if (!isHomeRoute) {
      setHeaderScrolled(false);
      return undefined;
    }

    const updateHeader = () => setHeaderScrolled(window.scrollY > 100);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, [isHomeRoute]);

  useEffect(() => {
    if (location.hash !== "#contact") return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("contact")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.pathname]);

  useEffect(() => {
    setManagementMenuOpen(false);
    setMobileNavOpen(false);
    if (!/^\/projects\/[^/]+$/.test(location.pathname)) setProjectDetailListChrome(false);
  }, [location.pathname]);

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 1301px)");
    const resetNavigationForLayoutChange = () => {
      setMobileNavOpen(false);
      setManagementMenuOpen(false);
      setAccountMenuOpen(false);
    };
    desktopMedia.addEventListener("change", resetNavigationForLayoutChange);
    return () => desktopMedia.removeEventListener("change", resetNavigationForLayoutChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMobileNavOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!managementMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (managementMenuOpen && !managementMenuRef.current?.contains(target)) {
        setManagementMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setManagementMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [managementMenuOpen]);

  async function handleLogout() {
    if (!window.confirm("确认退出当前账号？未保存的页面内容可能丢失。")) return;
    try {
      await logout();
    } finally {
      clearSession();
      queryClient.removeQueries({ queryKey: ["reports"] });
      queryClient.removeQueries({ queryKey: ["current-account-usage"] });
      setAccountMenuOpen(false);
      setMobileNavOpen(false);
      navigate("/", { replace: true });
    }
  }

  function handlePasswordChanged() {
    clearSession();
    queryClient.removeQueries({ queryKey: ["reports"] });
    queryClient.removeQueries({ queryKey: ["current-account-usage"] });
    setAuthNotice("密码已修改。请使用新密码重新登录。");
    setAuthModalOpen(true);
    navigate("/", { replace: true });
  }

  function requestAuthentication(onAuthenticated?: () => void) {
    pendingAuthenticationActionRef.current = onAuthenticated ?? null;
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    pendingAuthenticationActionRef.current = null;
    setAuthModalOpen(false);
    setAuthNotice("");
  }

  function handleAuthenticated() {
    const searchParams = new URLSearchParams(location.search);
    const redirect = safeRedirectPath(searchParams.get("redirect"));
    const pendingAction = pendingAuthenticationActionRef.current;
    pendingAuthenticationActionRef.current = null;
    queryClient.removeQueries({ queryKey: ["reports"] });
    queryClient.removeQueries({ queryKey: ["current-account-usage"] });
    setAuthNotice("");
    setAuthModalOpen(false);
    if (pendingAction) {
      pendingAction();
    } else if (redirect) {
      navigate(redirect, { replace: true });
    } else if (searchParams.get("login") === "1") {
      navigate(location.pathname, { replace: true });
    }
  }

  const displayName = user?.real_name?.trim() || user?.username || "";
  const managementLinks = [
    ...(canAccessAdmin ? [{ label: "账号管理", to: "/accounts" }, { label: "数据管理", to: "/data-management" }, { label: "推理设置", to: "/system-settings" }] : []),
    ...(canAccessReview ? [{ label: "审核工作台", to: "/review" }] : [])
  ];

  return (
    <div
      className={`${resolvedPageClass} ${usesDarkShell ? "site-dark-theme" : ""} ${isThemeHeroRoute ? "theme-hero-page" : ""}`.trim()}
      data-defect={defectKey}
    >
      <header
        ref={headerRef}
        hidden={isReviewDetailRoute || isStandaloneManagementRoute}
        className={`site-header centered-nav ${isHomeRoute ? "home-site-header" : ""} ${headerScrolled ? "is-scrolled" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}
        aria-label="顶部导航"
      >
        <NavLink className="brand" to="/" aria-label="建筑外墙巡检智能报告平台首页" onClick={() => setMobileNavOpen(false)}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-name">建筑外墙巡检智能报告平台</span>
        </NavLink>

        <button
          aria-controls="mobile-navigation-panel"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "收起主导航" : "展开主导航"}
          className="mobile-nav-toggle"
          type="button"
          onClick={() => {
            setMobileNavOpen((open) => !open);
            setAccountMenuOpen(false);
            setManagementMenuOpen(false);
          }}
        >
          {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>

        <div id="mobile-navigation-panel" className="mobile-nav-panel">
          <nav className="main-nav" aria-label="主导航">
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} end to="/" onClick={() => setMobileNavOpen(false)}>首页</NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/projects" onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}>专业检测</NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/reports" onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}>免费试用</NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? "active" : "")}
            to="/capabilities/time"
            onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}
          >
            检测时段推荐
          </NavLink>
          {managementLinks.length > 0 ? (
            <div ref={managementMenuRef} className={`nav-menu ${managementMenuOpen ? "is-open" : ""}`}>
              <button
                aria-controls="management-submenu"
                aria-expanded={managementMenuOpen}
                className={`nav-menu-trigger ${isManagementRoute ? "current" : ""}`}
                type="button"
                onClick={() => setManagementMenuOpen((open) => !open)}
              >
                管理中心 <ChevronDown aria-hidden="true" />
              </button>
              <div id="management-submenu" className="nav-submenu" role="menu" aria-label="管理中心">
                {managementLinks.map((item) => (
                  <NavLink
                    key={item.to}
                    role="menuitem"
                    to={item.to}
                    onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ) : null}
          </nav>

          {user ? (
          <div ref={accountMenuRef} className={`account-menu ${accountMenuOpen ? "is-open" : ""}`}>
            <button
              aria-controls="account-dropdown"
              aria-expanded={accountMenuOpen}
              className="account-trigger"
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span aria-hidden="true" className="account-avatar"><UserRound /></span>
              <span className="account-trigger-name">{displayName}</span>
              <ChevronDown aria-hidden="true" className="account-trigger-chevron" />
            </button>
            <div id="account-dropdown" className="account-dropdown" role="dialog" aria-label="本账号用量、余额和账户操作">
              <AccountUsageSummary
                isError={accountUsageQuery.isError}
                isLoading={accountUsageQuery.isLoading}
                onRetry={() => void accountUsageQuery.refetch()}
                usage={accountUsageQuery.data}
              />
              <div className="account-menu-actions">
                <button type="button" onClick={() => { setAccountMenuOpen(false); setMobileNavOpen(false); setPersonalInfoModalOpen(true); }}>
                  <UserRound aria-hidden="true" />个人信息
                </button>
                <button type="button" onClick={() => void handleLogout()}>
                  <LogOut aria-hidden="true" />退出登录
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button className="nav-cta auth-trigger" type="button" onClick={() => { setMobileNavOpen(false); requestAuthentication(); }}>
            <UserRound aria-hidden="true" />
            <span>登录</span>
          </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet context={{ requestAuthentication, setProjectDetailListChrome }} />
      </main>
      <AuthModal
        isOpen={authModalOpen}
        notice={authNotice}
        onAuthenticated={handleAuthenticated}
        onClose={closeAuthModal}
      />
      {user ? (
        <PersonalInfoModal
          isOpen={personalInfoModalOpen}
          onChangePassword={() => {
            setPersonalInfoModalOpen(false);
            setChangePasswordModalOpen(true);
          }}
          onClose={() => setPersonalInfoModalOpen(false)}
          user={user}
        />
      ) : null}
      <ChangePasswordModal
        isOpen={changePasswordModalOpen}
        onClose={() => setChangePasswordModalOpen(false)}
        onPasswordChanged={handlePasswordChanged}
      />
    </div>
  );
}

function AccountUsageSummary({
  isError,
  isLoading,
  onRetry,
  usage
}: {
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
  usage: CurrentAccountUsageResponse | undefined;
}) {
  if (isError) {
    return (
      <section className="account-popover-state" role="alert">
        <span>用量与余额加载失败</span>
        <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试</button>
      </section>
    );
  }

  if (isLoading || !usage) {
    return (
      <section className="account-popover-state account-popover-loading" aria-label="正在加载账号用量与余额">
        <span className="account-popover-spinner" aria-hidden="true" />
        <span>正在加载用量与余额…</span>
      </section>
    );
  }

  return (
    <section className="account-popover-summary" aria-label="本账号用量与余额">
      <div className="account-popover-heading account-balance-heading">
        <span><Gauge aria-hidden="true" />检测额度</span>
        <small>每日00:00重置</small>
      </div>
      <QuotaBalanceRow {...usage.trial_api_request_balance} />
    </section>
  );
}

function QuotaBalanceRow({ limit, remaining }: { limit: number; remaining: number }) {
  const percent = limit > 0 ? Math.min(100, Math.max(0, remaining / limit * 100)) : 0;
  const percentLabel = `剩余 ${Math.round(percent)}％`;
  return (
    <div className="account-balance-row">
      <div
        aria-label={`检测额度余额 ${remaining}，总额度 ${limit}`}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={remaining}
        className="account-balance-track"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <strong>{percentLabel}</strong>
    </div>
  );
}
