import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { logout } from "@/api/auth";
import { AuthModal } from "@/components/auth/AuthModal";
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal";
import { useAuthStore } from "@/stores/useAuthStore";

const defectLinks = [
  { label: "裂缝检测", to: "/capabilities/crack" },
  { label: "剥落检测", to: "/capabilities/spalling" },
  { label: "空鼓检测", to: "/capabilities/hollow" },
  { label: "渗漏检测", to: "/capabilities/leakage" },
  { label: "锈蚀检测", to: "/capabilities/corrosion" }
];

function pageClass(pathname: string) {
  if (pathname === "/trial") return "detail-page trial-experience-page";
  if (pathname === "/projects/new") return "project-page new-project-page";
  if (/^\/projects\/[^/]+$/.test(pathname)) return "project-page project-detail-page";
  if (pathname.startsWith("/projects") || pathname.startsWith("/accounts") || pathname.startsWith("/reports") || pathname.startsWith("/review")) {
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
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [capabilityMenuOpen, setCapabilityMenuOpen] = useState(false);
  const [managementMenuOpen, setManagementMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const defectKey = location.pathname.match(/^\/capabilities\/(crack|spalling|hollow|leakage|corrosion)$/)?.[1];
  const isCapabilityRoute = Boolean(defectKey) || location.pathname === "/trial";
  const isManagementRoute = location.pathname.startsWith("/projects") || location.pathname.startsWith("/accounts") || location.pathname.startsWith("/review");
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

  async function handleLogout() {
    try {
      await logout();
    } finally {
      clearSession();
      setAccountMenuOpen(false);
      navigate("/", { replace: true });
    }
  }

  function handlePasswordChanged() {
    clearSession();
    navigate("/", { replace: true });
  }

  function handleAuthenticated() {
    const searchParams = new URLSearchParams(location.search);
    const redirect = safeRedirectPath(searchParams.get("redirect"));
    setAuthModalOpen(false);
    if (redirect) {
      navigate(redirect, { replace: true });
    } else if (searchParams.get("login") === "1") {
      navigate(location.pathname, { replace: true });
    }
  }

  const displayName = user?.real_name?.trim() || user?.username || "";
  const roleLabel = user?.role === "admin" ? "管理员" : user?.role === "reviewer" ? "内部审核" : "客户用户";
  const avatarInitial = displayName.slice(0, 1).toLocaleUpperCase();
  const managementLinks = [
    ...(canAccessAdmin ? [{ label: "项目管理", to: "/projects" }, { label: "账号管理", to: "/accounts" }] : []),
    ...(canAccessReview ? [{ label: "审核工作台", to: "/review" }] : [])
  ];

  return (
    <div className={pageClass(location.pathname)} data-defect={defectKey}>
      <header className="site-header centered-nav" aria-label="顶部导航">
        <NavLink className="brand" to="/" aria-label="建筑外墙巡检智能报告平台首页">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-name">建筑外墙巡检智能报告平台</span>
        </NavLink>

        <nav className="main-nav" aria-label="主导航">
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} end to="/">首页</NavLink>
          <div className={`nav-menu ${capabilityMenuOpen ? "is-open" : ""}`}>
            <button
              aria-controls="ai-submenu"
              aria-expanded={capabilityMenuOpen}
              className={`nav-menu-trigger ${isCapabilityRoute ? "current" : ""}`}
              type="button"
              onClick={() => { setCapabilityMenuOpen((open) => !open); setManagementMenuOpen(false); }}
            >
              AI检测能力 <ChevronDown aria-hidden="true" />
            </button>
            <div id="ai-submenu" className="nav-submenu" role="menu" aria-label="AI检测能力">
              {defectLinks.map((item) => (
                <NavLink
                  key={item.to}
                  role="menuitem"
                  to={item.to}
                  onClick={() => setCapabilityMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
          <NavLink
            className={({ isActive }) => (isActive ? "active" : "")}
            to="/capabilities/time"
            onClick={() => { setCapabilityMenuOpen(false); setManagementMenuOpen(false); }}
          >
            检测时段推荐
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/reports" onClick={() => { setCapabilityMenuOpen(false); setManagementMenuOpen(false); }}>检测结果</NavLink>
          {managementLinks.length > 0 ? (
            <div className={`nav-menu ${managementMenuOpen ? "is-open" : ""}`}>
              <button
                aria-controls="management-submenu"
                aria-expanded={managementMenuOpen}
                className={`nav-menu-trigger ${isManagementRoute ? "current" : ""}`}
                type="button"
                onClick={() => { setManagementMenuOpen((open) => !open); setCapabilityMenuOpen(false); }}
              >
                管理中心 <ChevronDown aria-hidden="true" />
              </button>
              <div id="management-submenu" className="nav-submenu" role="menu" aria-label="管理中心">
                {managementLinks.map((item) => (
                  <NavLink
                    key={item.to}
                    role="menuitem"
                    to={item.to}
                    onClick={() => { setCapabilityMenuOpen(false); setManagementMenuOpen(false); }}
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
              <span aria-hidden="true" className="account-avatar">{avatarInitial}</span>
              <span className="account-trigger-name">{displayName}</span>
              <ChevronDown aria-hidden="true" className="account-trigger-chevron" />
            </button>
            <div id="account-dropdown" className="account-dropdown" role="menu" aria-label="账户菜单">
              <div className="account-profile">
                <span aria-hidden="true" className="account-avatar account-avatar-large">{avatarInitial}</span>
                <span>
                  <strong>{displayName}</strong>
                  <small>{roleLabel}</small>
                </span>
              </div>
              <div className="account-menu-actions">
                <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setChangePasswordModalOpen(true); }}>
                  <KeyRound aria-hidden="true" />修改密码
                </button>
                <button type="button" role="menuitem" onClick={() => void handleLogout()}>
                  <LogOut aria-hidden="true" />退出登录
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button className="nav-cta auth-trigger" type="button" onClick={() => setAuthModalOpen(true)}>
            <UserRound aria-hidden="true" />
            <span>登录</span>
          </button>
        )}
      </header>

      <main className="app-main"><Outlet /></main>
      <AuthModal
        isOpen={authModalOpen}
        onAuthenticated={handleAuthenticated}
        onClose={() => setAuthModalOpen(false)}
      />
      <ChangePasswordModal
        isOpen={changePasswordModalOpen}
        onClose={() => setChangePasswordModalOpen(false)}
        onPasswordChanged={handlePasswordChanged}
      />
    </div>
  );
}
