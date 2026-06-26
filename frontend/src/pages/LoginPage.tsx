import { Button, Card, CardBody, Input } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { Building2, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "登录失败，请稍后重试。";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useAuthStore((state) => state.status);
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [username, setUsername] = useState("customer");
  const [password, setPassword] = useState("Customer123!");
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";

  const loginMutation = useMutation({
    mutationFn: () => login({ username, password }),
    onSuccess: (result) => {
      setAuthenticated(result.user, result.access_token);
      navigate(from, { replace: true });
    }
  });

  if (authStatus === "authenticated") return <Navigate replace to="/" />;

  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,18,35,0.96),rgba(2,18,35,0.63)),url('/hero-facade.png')] bg-cover bg-center" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-action text-lg font-black">外</span>
            <div>
              <p className="text-base font-black">外墙巡检智能平台</p>
              <p className="text-xs font-semibold text-slate-300">Facade AI Inspection</p>
            </div>
          </div>
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-300">Secure workspace</p>
          <h1 className="mt-4 text-5xl font-black leading-tight">用清晰的权限边界，守住每一次巡检交付。</h1>
          <p className="mt-5 max-w-lg text-base font-medium leading-8 text-slate-200">
            客户、审核人员与管理员在同一平台协作，项目数据和审核流程各归其位。
          </p>
        </div>
      </section>

      <section className="grid place-items-center p-5 sm:p-8">
        <Card className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-none">
          <CardBody className="gap-6 p-6 sm:p-8">
            <div>
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-action-soft text-action lg:hidden">
                <Building2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-action">Account sign in</p>
              <h1 className="mt-2 text-3xl font-black text-ink">登录工作台</h1>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                使用已分配的账号登录，系统会按角色展示可用功能。
              </p>
            </div>

            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                loginMutation.mutate();
              }}
            >
              <Input
                isRequired
                label="用户名"
                placeholder="请输入用户名"
                startContent={<UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                value={username}
                onValueChange={setUsername}
              />
              <Input
                isRequired
                label="密码"
                placeholder="请输入密码"
                startContent={<LockKeyhole className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                type="password"
                value={password}
                onValueChange={setPassword}
              />
              {loginMutation.isError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                  {getErrorMessage(loginMutation.error)}
                </p>
              ) : null}
              <Button
                className="mt-2 rounded-lg font-bold"
                color="primary"
                isLoading={loginMutation.isPending}
                type="submit"
              >
                登录
              </Button>
            </form>

            <div className="border-t border-slate-200 pt-4 text-xs font-semibold leading-6 text-slate-500">
              开发测试账号：customer / Customer123!；reviewer / Reviewer123!；admin / Admin123!
            </div>
          </CardBody>
        </Card>
      </section>
    </main>
  );
}
