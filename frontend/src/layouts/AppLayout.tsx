import { ChevronDown, Gauge, LogOut, Menu, RefreshCw, UserRound, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { currentAccountUsageQueryOptions } from "@/api/accounts";
import { logout } from "@/api/auth";
import { AUTH_UNAUTHORIZED_EVENT } from "@/api/client";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthModal } from "@/components/auth/AuthModal";
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal";
import { getListPageHeader, ListPageHeader } from "@/components/ListPageHeader";
import { PersonalInfoModal } from "@/components/auth/PersonalInfoModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type { CurrentAccountUsageResponse } from "@/types/accountUsage";

function pageClass(pathname: string) {
  if (pathname === "/") return "home-route";
  if (pathname === "/trials/new") return "project-page new-project-page project-list-chrome trial-route";
  if (pathname === "/trials") return "project-page project-list-route report-list-route";
  if (pathname === "/detections") return "project-page project-list-route";
  if (/^\/review\/detections\/[^/]+\/model$/.test(pathname)) return "building-model-route";
  if (/^\/detections\/[^/]+\/model$/.test(pathname)) return "building-model-route";
  if (pathname.startsWith("/accounts")) return "project-page account-management-route";
  if (pathname.startsWith("/data-management")) return "project-page data-management-route";
  if (pathname.startsWith("/system-settings")) return "project-page system-settings-route";
  if (pathname === "/review") return "project-page review-workbench-route review-workbench-list-route";
  if (/^\/review\/detections\/[^/]+$/.test(pathname)) return "project-page review-workbench-route review-workbench-detail-route";
  if (pathname.startsWith("/review")) return "project-page review-workbench-route";
  if (/^\/detections\/results\/[^/]+$/.test(pathname)) return "project-page report-detail-route formal-result-route";
  if (/^\/trials\/[^/]+$/.test(pathname) || /^\/reports\/[^/]+$/.test(pathname)) return "project-page report-detail-route formal-result-route";
  if (pathname === "/detections/new") return "project-page new-project-page project-list-chrome";
  if (/^\/detections\/[^/]+$/.test(pathname)) return "project-page project-detail-page project-list-chrome";
  if (pathname.startsWith("/detections") || pathname.startsWith("/trials") || pathname.startsWith("/accounts") || pathname.startsWith("/data-management") || pathname.startsWith("/system-settings") || pathname.startsWith("/review")) {
    return "project-page";
  }
  if (pathname.startsWith("/capabilities")) return "detail-page";
  return "";
}

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function usesAppSidebar(pathname: string) {
  return pathname === "/detections"
    || pathname === "/trials"
    || pathname === "/review"
    || pathname === "/accounts";
}

function sidebarCompactBreakpoint(pathname: string) {
  if (pathname === "/detections") return 1663;
  if (pathname === "/trials") return 1533;
  return 1447;
}

function isSidebarCompactViewport(breakpoint: number) {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
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
  const [homeNavigationVisible, setHomeNavigationVisible] = useState(true);
  const [projectDetailListChrome, setProjectDetailListChrome] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("exterior-wall:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const sidebarBreakpoint = sidebarCompactBreakpoint(location.pathname);
  const [sidebarViewportCompact, setSidebarViewportCompact] = useState(() => isSidebarCompactViewport(sidebarBreakpoint));
  const hasAppSidebar = usesAppSidebar(location.pathname);
  const isSidebarCollapsed = sidebarCollapsed || sidebarViewportCompact;
  const accountUsageQuery = useQuery({
    ...currentAccountUsageQueryOptions,
    enabled: Boolean(user && (accountMenuOpen || (hasAppSidebar && !isSidebarCollapsed)))
  });
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const sidebarAccountMenuRef = useRef<HTMLElement>(null);
  const managementMenuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pendingAuthenticationActionRef = useRef<(() => void) | null>(null);
  const defectKey = location.pathname.match(/^\/capabilities\/(crack|spalling|missing|moisture|corrosion|hollow)$/)?.[1];
  const isBuildingModelRoute = /^\/detections\/[^/]+\/model$/.test(location.pathname);
  const isReviewBuildingModelRoute = /^\/review\/detections\/[^/]+\/model$/.test(location.pathname);
  const isReviewDetailRoute = /^\/review\/detections\/[^/]+$/.test(location.pathname);
  const isStandaloneManagementRoute = (
    location.pathname === "/system-settings"
    || location.pathname.startsWith("/accounts")
    || location.pathname.startsWith("/data-management")
    || location.pathname === "/review"
  );
  const isManagementRoute = location.pathname.startsWith("/accounts") || location.pathname.startsWith("/data-management") || location.pathname.startsWith("/system-settings");
  const isHomeRoute = location.pathname === "/";
  const isCreationRoute = location.pathname === "/detections/new" || location.pathname === "/trials/new";
  const currentPageClass = pageClass(location.pathname);
  const resolvedPageClass = `${currentPageClass}${projectDetailListChrome ? " project-list-chrome" : ""}`;
  const isDetectionInnerRoute = location.pathname !== "/detections" && location.pathname.startsWith("/detections/");
  const isTrialInnerRoute = location.pathname !== "/trials" && location.pathname.startsWith("/trials/");
  const isLegacyReportDetailRoute = /^\/reports\/[^/]+$/.test(location.pathname);
  const listPageHeader = getListPageHeader(location.pathname);
  const showsSiteHeader = !isBuildingModelRoute
    && !isReviewBuildingModelRoute
    && !isReviewDetailRoute
    && (!isStandaloneManagementRoute || Boolean(listPageHeader))
    && !isDetectionInnerRoute
    && !isTrialInnerRoute
    && !isLegacyReportDetailRoute;
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
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(`(max-width: ${sidebarBreakpoint}px)`);
    const updateSidebarViewport = () => setSidebarViewportCompact(mediaQuery.matches);
    updateSidebarViewport();
    mediaQuery.addEventListener("change", updateSidebarViewport);
    return () => mediaQuery.removeEventListener("change", updateSidebarViewport);
  }, [sidebarBreakpoint]);

  useEffect(() => {
    try {
      window.localStorage.setItem("exterior-wall:sidebar-collapsed", String(sidebarCollapsed));
    } catch {
      // The layout still works if the browser does not expose persistent storage.
    }
  }, [sidebarCollapsed]);

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
    if (!showsSiteHeader) {
      setHeaderScrolled(false);
      setHomeNavigationVisible(true);
      return undefined;
    }

    const updateHeader = () => setHeaderScrolled(window.scrollY > 100);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, [showsSiteHeader]);

  useEffect(() => {
    if (!isHomeRoute) return undefined;

    const handleVisibilityChange = (event: Event) => {
      setHomeNavigationVisible((event as CustomEvent<boolean>).detail);
    };

    window.addEventListener("home-navigation-visibility", handleVisibilityChange);
    return () => window.removeEventListener("home-navigation-visibility", handleVisibilityChange);
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
    setAccountMenuOpen(false);
    if (!/^\/detections\/[^/]+$/.test(location.pathname)) setProjectDetailListChrome(false);
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
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target) && !sidebarAccountMenuRef.current?.contains(target)) {
        setAccountMenuOpen(false);
      }
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
  const sidebarShowsTrialQuota = location.pathname.startsWith("/trials");
  const sidebarQuotaBalance = accountUsageQuery.data
    ? (
        sidebarShowsTrialQuota
          ? accountUsageQuery.data.trial_daily_photo_upload_balance
          : accountUsageQuery.data.formal_monthly_photo_upload_balance
      )
    : undefined;
  const sidebarQuotaValueLabel = sidebarQuotaBalance
    ? `${sidebarQuotaBalance.remaining} / ${sidebarQuotaBalance.limit} 张`
    : "--";
  const sidebarQuotaLabel = sidebarShowsTrialQuota ? "快速体验额度" : "专业检测额度";
  const sidebarQuotaPeriodLabel = sidebarShowsTrialQuota ? "今日" : "本月";
  const managementLinks = [
    ...(canAccessAdmin ? [{ label: "账号管理", to: "/accounts" }, { label: "数据管理", to: "/data-management" }, { label: "推理设置", to: "/system-settings" }] : [])
  ];
  const renderAccountDropdown = (id: string) => (
    <div id={id} className="account-dropdown" role="dialog" aria-label="本账号用量、余额和账户操作">
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
  );
  const accountControl = user ? (
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
      {renderAccountDropdown("account-dropdown")}
    </div>
  ) : (
    <button className="nav-cta auth-trigger" type="button" onClick={() => { setMobileNavOpen(false); requestAuthentication(); }}>
      <UserRound aria-hidden="true" />
      <span>登录</span>
    </button>
  );

  return (
    <div
      className={`${resolvedPageClass}${hasAppSidebar ? " app-sidebar-route" : ""}${hasAppSidebar && isSidebarCollapsed ? " app-sidebar-collapsed" : ""}`.trim()}
      data-defect={defectKey}
    >
      {hasAppSidebar ? (
        <AppSidebar
          accountMenu={renderAccountDropdown("sidebar-account-dropdown")}
          accountMenuOpen={accountMenuOpen}
          accountMenuRef={sidebarAccountMenuRef}
          canAccessReview={canAccessReview}
          canToggle={!sidebarViewportCompact}
          collapsed={isSidebarCollapsed}
          onCollapsedChange={() => {
            if (!sidebarViewportCompact) setSidebarCollapsed((collapsed) => !collapsed);
          }}
          onAccountMenuToggle={() => setAccountMenuOpen((open) => !open)}
          onLogin={() => requestAuthentication()}
          onLogout={() => void handleLogout()}
          onPersonalInfo={() => {
            setAccountMenuOpen(false);
            setMobileNavOpen(false);
            setPersonalInfoModalOpen(true);
          }}
          quotaValueLabel={sidebarQuotaValueLabel}
          quotaLabel={sidebarQuotaLabel}
          quotaPeriodLabel={sidebarQuotaPeriodLabel}
          user={user}
        />
      ) : null}
      <header
        ref={headerRef}
        hidden={!showsSiteHeader || (isHomeRoute && !homeNavigationVisible)}
        className={`site-header centered-nav home-site-header ${listPageHeader ? "list-page-site-header" : ""} ${isCreationRoute ? "creation-page-header" : ""} ${headerScrolled && !listPageHeader ? "is-scrolled" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}
        aria-label="顶部导航"
      >
        <NavLink className="brand" to="/" aria-label="外墙智能巡检平台首页" onClick={() => setMobileNavOpen(false)}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-name">外墙智能巡检平台</span>
        </NavLink>

        {listPageHeader ? <ListPageHeader config={listPageHeader} /> : null}

        {!listPageHeader ? <button
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
        </button> : null}

        {!listPageHeader ? <div id="mobile-navigation-panel" className="mobile-nav-panel">
          <nav className="main-nav" aria-label="主导航">
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} end to="/" onClick={() => setMobileNavOpen(false)}>首页</NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/detections" onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}>专业检测</NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/trials" onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}>快速体验</NavLink>
          {canAccessReview ? (
            <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/review" onClick={() => { setManagementMenuOpen(false); setMobileNavOpen(false); }}>工作台</NavLink>
          ) : null}
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

          {accountControl}
        </div> : null}
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
        <span><Gauge aria-hidden="true" />照片上传额度</span>
        <small>北京时间重置</small>
      </div>
      <QuotaBalanceRow label="快速体验 · 今日" {...usage.trial_daily_photo_upload_balance} />
      <QuotaBalanceRow label="快速体验 · 本月" {...usage.trial_monthly_photo_upload_balance} />
      <QuotaBalanceRow label="专业检测 · 本月" {...usage.formal_monthly_photo_upload_balance} />
    </section>
  );
}

function QuotaBalanceRow({ label, limit, remaining }: { label: string; limit: number; remaining: number }) {
  return (
    <div className="account-balance-row">
      <strong aria-label={`${label}照片上传额度余额 ${remaining} 张，总额度 ${limit} 张`}>
        {label} · 剩余 {remaining} / {limit} 张
      </strong>
    </div>
  );
}
