import { useMutation } from "@tanstack/react-query";
import { CircleCheck, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { createTrialApplication, login } from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";
import type { TrialApplicationPayload } from "@/types/auth";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "登录失败，请稍后重试。";
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
}

type AuthMode = "login" | "trial-application";

const emptyTrialApplicationForm: TrialApplicationPayload = {
  username: "",
  password: "",
  real_name: "",
  phone: "",
  organization: ""
};

/** The single sign-in surface for the whole application. It follows the prototype dialog. */
export function AuthModal({ isOpen, onClose, onAuthenticated }: AuthModalProps) {
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("customer");
  const [password, setPassword] = useState("Customer123!");
  const [trialApplicationForm, setTrialApplicationForm] = useState<TrialApplicationPayload>(emptyTrialApplicationForm);
  const [trialApplicationSubmittedUsername, setTrialApplicationSubmittedUsername] = useState<string | null>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const trialUsernameInputRef = useRef<HTMLInputElement>(null);

  const loginMutation = useMutation({
    mutationFn: () => login({ username, password }),
    onSuccess: (result) => {
      setAuthenticated(result.user, result.access_token);
      if (onAuthenticated) onAuthenticated();
      else onClose();
    }
  });

  const trialApplicationMutation = useMutation({
    mutationFn: () => createTrialApplication(trialApplicationForm),
    onSuccess: (result) => {
      setTrialApplicationSubmittedUsername(result.username);
      setUsername(result.username);
      setPassword(trialApplicationForm.password);
    }
  });

  useEffect(() => {
    if (isOpen) return;
    setMode("login");
    setTrialApplicationForm(emptyTrialApplicationForm);
    setTrialApplicationSubmittedUsername(null);
    loginMutation.reset();
    trialApplicationMutation.reset();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.requestAnimationFrame(() => {
      if (mode === "login") usernameInputRef.current?.focus();
      else trialUsernameInputRef.current?.focus();
    });
  }, [isOpen, mode]);

  function switchToLogin() {
    loginMutation.reset();
    trialApplicationMutation.reset();
    setTrialApplicationSubmittedUsername(null);
    setMode("login");
  }

  function switchToTrialApplication() {
    loginMutation.reset();
    trialApplicationMutation.reset();
    setTrialApplicationSubmittedUsername(null);
    setMode("trial-application");
  }

  function updateTrialApplicationField(field: keyof TrialApplicationPayload, value: string) {
    setTrialApplicationForm((current) => ({ ...current, [field]: value }));
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  function handleTrialApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trialApplicationMutation.mutate();
  }

  if (!isOpen) return null;

  const isTrialApplicationSuccess = mode === "trial-application" && Boolean(trialApplicationSubmittedUsername);

  return (
    <div
      aria-label={isTrialApplicationSuccess ? "申请已提交" : undefined}
      aria-labelledby={isTrialApplicationSuccess ? undefined : "auth-title"}
      aria-modal="true"
      className="auth-modal is-open"
      role="dialog"
    >
      <button aria-label="关闭登录弹窗" className="auth-modal-backdrop" type="button" onClick={onClose} />
      <section className={`auth-dialog ${mode === "trial-application" ? "trial-application-dialog" : ""} ${isTrialApplicationSuccess ? "auth-success-dialog" : ""}`}>
        <button aria-label="关闭登录弹窗" className="auth-close" type="button" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        {!isTrialApplicationSuccess ? (
          <div className="auth-dialog-heading">
            <h2 id="auth-title">{mode === "login" ? "账号登录" : "申请试用"}</h2>
          </div>
        ) : null}
        {mode === "login" ? (
          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <label className="auth-field">
              <span>用户名</span>
              <input
                ref={usernameInputRef}
                autoComplete="username"
                placeholder="请输入用户名"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                autoComplete="current-password"
                placeholder="请输入密码"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="auth-check">
              <input defaultChecked type="checkbox" />
              <span>保持登录状态</span>
            </label>
            {loginMutation.isError ? <p className="auth-status auth-status-error" role="alert">{getErrorMessage(loginMutation.error)}</p> : null}
            <button className="auth-submit" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? "正在登录…" : "登录"}
            </button>
            <div className="auth-switch-row">
              <span>还没有账号？</span>
              <button className="auth-link-button" disabled={loginMutation.isPending} type="button" onClick={switchToTrialApplication}>
                申请试用
              </button>
            </div>
          </form>
        ) : trialApplicationSubmittedUsername ? (
          <div className="auth-form auth-success-panel" role="status">
            <span className="auth-success-icon" aria-hidden="true">
              <CircleCheck />
            </span>
            <p className="auth-success-title">申请已提交</p>
            <button className="auth-submit" type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleTrialApplicationSubmit}>
            <label className="auth-field">
              <span>用户名</span>
              <input
                ref={trialUsernameInputRef}
                autoComplete="username"
                placeholder="用于后续登录"
                required
                value={trialApplicationForm.username}
                onChange={(event) => updateTrialApplicationField("username", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                autoComplete="new-password"
                minLength={8}
                placeholder="至少 8 位"
                required
                type="password"
                value={trialApplicationForm.password}
                onChange={(event) => updateTrialApplicationField("password", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>姓名</span>
              <input
                autoComplete="name"
                placeholder="请输入姓名"
                required
                value={trialApplicationForm.real_name}
                onChange={(event) => updateTrialApplicationField("real_name", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>联系电话</span>
              <input
                autoComplete="tel"
                placeholder="请输入联系电话"
                required
                value={trialApplicationForm.phone}
                onChange={(event) => updateTrialApplicationField("phone", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>单位名称</span>
              <input
                autoComplete="organization"
                placeholder="请输入单位名称"
                required
                value={trialApplicationForm.organization}
                onChange={(event) => updateTrialApplicationField("organization", event.target.value)}
              />
            </label>
            {trialApplicationMutation.isError ? <p className="auth-status auth-status-error" role="alert">{getErrorMessage(trialApplicationMutation.error)}</p> : null}
            <button className="auth-submit" disabled={trialApplicationMutation.isPending} type="submit">
              {trialApplicationMutation.isPending ? "正在提交…" : "提交申请"}
            </button>
            <div className="auth-switch-row">
              <span>已有账号？</span>
              <button className="auth-link-button" disabled={trialApplicationMutation.isPending} type="button" onClick={switchToLogin}>
                返回登录
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
