import { Button } from "@heroui/react";
import {
  BrainCircuit,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Home,
  ImageUp,
  LogOut,
  Menu,
  X
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { logout } from "@/api/auth";
import { useAppStore } from "@/stores/useAppStore";
import { useAuthStore } from "@/stores/useAuthStore";

const navigationItems = [
  { label: "工作台", to: "/", icon: Home, end: true },
  { label: "AI检测体验", to: "/trial", icon: ImageUp },
  { label: "AI检测能力", to: "/capabilities", icon: BrainCircuit },
  { label: "项目管理", to: "/projects", icon: FolderKanban },
  { label: "审核工作台", to: "/review", icon: ClipboardCheck, roles: ["reviewer", "admin"] },
  { label: "检测报告", to: "/reports", icon: FileText }
];

export function AppLayout() {
  const navigate = useNavigate();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const visibleNavigationItems = navigationItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );
  const roleLabel = user?.role === "admin" ? "管理员" : user?.role === "reviewer" ? "内部审核" : "客户用户";

  async function handleLogout() {
    try {
      await logout();
    } finally {
      clearSession();
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <Button
            isIconOnly
            aria-label="打开导航"
            className="rounded-lg border border-slate-200 bg-white text-slate-700 shadow-none lg:hidden"
            size="sm"
            variant="flat"
            onPress={toggleSidebar}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>

          <NavLink className="flex items-center gap-3" to="/">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-action text-white">
              <span className="text-sm font-black">外</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-black text-ink">
                外墙巡检智能平台
              </span>
              <span className="block text-xs font-semibold text-slate-500">
                Facade AI Inspection
              </span>
            </span>
          </NavLink>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-black text-slate-800">{user?.real_name || user?.username}</p>
              <p className="text-xs font-semibold text-slate-500">{roleLabel}</p>
            </div>
            <Button
              className="rounded-lg border border-slate-200 bg-white font-bold text-slate-700 shadow-none"
              size="sm"
              startContent={<LogOut className="h-4 w-4" aria-hidden="true" />}
              variant="flat"
              onPress={() => void handleLogout()}
            >
              退出登录
            </Button>
          </div>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-16 lg:z-20 lg:h-[calc(100svh-4rem)] lg:w-auto lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4 lg:hidden">
            <strong className="text-sm text-slate-800">平台导航</strong>
            <Button
              isIconOnly
              aria-label="关闭导航"
              className="rounded-lg border border-slate-200 bg-white text-slate-700 shadow-none"
              size="sm"
              variant="flat"
              onPress={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>

          <nav className="grid gap-1 p-3" aria-label="主导航">
            {visibleNavigationItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold transition ${
                      isActive
                        ? "bg-action-soft text-action"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    }`
                  }
                  end={item.end}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {sidebarOpen ? (
          <button
            aria-label="关闭导航遮罩"
            className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden"
            type="button"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
