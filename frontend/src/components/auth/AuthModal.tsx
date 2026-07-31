import { useMutation } from "@tanstack/react-query";
import { CircleCheck, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { createTrialApplication, login } from "@/api/auth";
import { ApiError } from "@/api/client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { useAuthStore } from "@/stores/useAuthStore";
import type { TrialApplicationPayload } from "@/types/auth";
import { createClientId } from "@/utils/id";

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.retryAfterSeconds) {
    return `${error.message}（约 ${error.retryAfterSeconds} 秒后可重试）`;
  }
  return error instanceof Error ? error.message : "登录失败，请稍后重试。";
}

interface AuthModalProps {
  isOpen: boolean;
  notice?: string;
  onClose: () => void;
  onAuthenticated?: () => void;
}

type AuthMode = "login" | "trial-application";

const emptyTrialApplicationForm: TrialApplicationPayload = {
  username: "",
  password: "",
  phone: ""
};

/** The single sign-in surface for the whole application. It follows the prototype dialog. */
export function AuthModal({ isOpen, notice, onClose, onAuthenticated }: AuthModalProps) {
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [mode, setMode] = useState<AuthMode>("login");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [trialApplicationForm, setTrialApplicationForm] = useState<TrialApplicationPayload>(emptyTrialApplicationForm);
  const [trialPasswordConfirmation, setTrialPasswordConfirmation] = useState("");
  const [registrationAgreementAccepted, setRegistrationAgreementAccepted] = useState(false);
  const [trialValidationError, setTrialValidationError] = useState("");
  const [trialApplicationSubmittedUsername, setTrialApplicationSubmittedUsername] = useState<string | null>(null);
  const [trialApplicationIdempotencyKey, setTrialApplicationIdempotencyKey] = useState(() => createClientId("registration"));
  const [loginHelp, setLoginHelp] = useState("");
  const identityInputRef = useRef<HTMLInputElement>(null);
  const trialUsernameInputRef = useRef<HTMLInputElement>(null);

  const loginMutation = useMutation({
    mutationFn: () => login({ identity, password }),
    onSuccess: (result) => {
      setAuthenticated(result.user, result.access_token);
      if (onAuthenticated) onAuthenticated();
      else onClose();
    }
  });

  const trialApplicationMutation = useMutation({
    mutationFn: () => createTrialApplication(trialApplicationForm, trialApplicationIdempotencyKey),
    onSuccess: (result) => {
      setTrialApplicationSubmittedUsername(result.username);
      setIdentity(trialApplicationForm.phone);
      setPassword(trialApplicationForm.password);
    }
  });

  useEffect(() => {
    if (isOpen) return;
    setMode("login");
    setIdentity("");
    setPassword("");
    setTrialApplicationForm(emptyTrialApplicationForm);
    setTrialPasswordConfirmation("");
    setRegistrationAgreementAccepted(false);
    setTrialValidationError("");
    setTrialApplicationSubmittedUsername(null);
    setTrialApplicationIdempotencyKey(createClientId("registration"));
    setLoginHelp("");
    loginMutation.reset();
    trialApplicationMutation.reset();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, mode, onClose, trialApplicationForm, trialPasswordConfirmation]);

  useEffect(() => {
    if (!isOpen) return;
    window.requestAnimationFrame(() => {
      if (mode === "login") identityInputRef.current?.focus();
      else trialUsernameInputRef.current?.focus();
    });
  }, [isOpen, mode]);

  function switchToLogin() {
    if (hasUnsavedRegistration() && !window.confirm("注册信息尚未提交，确认放弃并返回登录？")) return;
    loginMutation.reset();
    trialApplicationMutation.reset();
    setTrialApplicationSubmittedUsername(null);
    setTrialValidationError("");
    setMode("login");
  }

  function switchToTrialApplication() {
    loginMutation.reset();
    trialApplicationMutation.reset();
    setTrialApplicationSubmittedUsername(null);
    setTrialValidationError("");
    setMode("trial-application");
  }

  function updateTrialApplicationField(field: keyof TrialApplicationPayload, value: string) {
    setTrialApplicationForm((current) => ({ ...current, [field]: value }));
    setTrialValidationError("");
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  function handleTrialApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trialApplicationForm.password !== trialPasswordConfirmation) {
      setTrialValidationError("两次输入的密码不一致。");
      return;
    }
    if (!registrationAgreementAccepted) {
      setTrialValidationError("请先阅读并同意《用户服务协议》和《隐私政策》。");
      return;
    }
    setTrialValidationError("");
    trialApplicationMutation.mutate();
  }

  function requestClose() {
    if (hasUnsavedRegistration() && !window.confirm("注册信息尚未提交，确认放弃并关闭？")) return;
    onClose();
  }

  function hasUnsavedRegistration() {
    return mode === "trial-application"
      && !trialApplicationSubmittedUsername
      && (
        Object.values(trialApplicationForm).some((value) => value.trim())
        || Boolean(trialPasswordConfirmation)
      );
  }

  if (!isOpen) return null;

  const isTrialApplicationSuccess = mode === "trial-application" && Boolean(trialApplicationSubmittedUsername);

  return (
    <div
      aria-label={isTrialApplicationSuccess ? "账号创建成功" : undefined}
      aria-labelledby={isTrialApplicationSuccess ? undefined : "auth-title"}
      aria-modal="true"
      className="auth-modal is-open"
      role="dialog"
    >
      <button aria-label="关闭登录弹窗" className="auth-modal-backdrop" type="button" onClick={requestClose} />
      <section className={`auth-dialog ${mode === "login" ? "auth-login-dialog" : "trial-application-dialog"} ${isTrialApplicationSuccess ? "auth-success-dialog" : ""}`}>
        <button aria-label="关闭登录弹窗" className="auth-close" type="button" onClick={requestClose}>
          <X aria-hidden="true" />
        </button>
        {!isTrialApplicationSuccess ? (
          <div className="auth-dialog-heading auth-dialog-brand-heading">
            <h2 id="auth-title" className="auth-system-brand">
              <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
              <span>欢迎使用外墙巡检平台</span>
            </h2>
          </div>
        ) : null}
        {mode === "login" ? (
          <form className="auth-form auth-login-form" onSubmit={handleLoginSubmit}>
            <label className="auth-field">
              <span>用户名/手机号</span>
              <input
                ref={identityInputRef}
                aria-label="用户名或手机号"
                autoComplete="username"
                placeholder="请输入用户名或手机号"
                required
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
              />
            </label>
            <div className="auth-password-field">
              <PasswordInput
                aria-label="密码"
                autoComplete="current-password"
                label="密码"
                placeholder="请输入密码"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button className="auth-link-button auth-forgot-password" type="button" onClick={() => setLoginHelp("请联系平台管理员核验身份并重置密码。")}>
                忘记密码
              </button>
            </div>
            {notice ? <p className="auth-status auth-status-info" role="status">{notice}</p> : null}
            {loginHelp ? <p className="auth-status auth-status-info" role="status">{loginHelp}</p> : null}
            {loginMutation.isError ? <p className="auth-status auth-status-error" role="alert">{getErrorMessage(loginMutation.error)}</p> : null}
            <button className="auth-submit" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? "正在登录…" : "登录"}
            </button>
            <div className="auth-switch-row">
              <span>还没有账号？</span>
              <button className="auth-link-button" disabled={loginMutation.isPending} type="button" onClick={switchToTrialApplication}>
                注册账号
              </button>
            </div>
            <div className="auth-legal-links" aria-label="登录相关法律文件">
              <a href="/privacy" rel="noreferrer" target="_blank">隐私政策</a>
              <a href="/terms" rel="noreferrer" target="_blank">用户服务协议</a>
            </div>
          </form>
        ) : trialApplicationSubmittedUsername ? (
          <div className="auth-form auth-success-panel" role="status">
            <span className="auth-success-icon" aria-hidden="true">
              <CircleCheck />
            </span>
            <p className="auth-success-title">账号创建成功</p>
            <button className="auth-submit" type="button" onClick={switchToLogin}>
              返回登录
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
                pattern=".*\S.*"
                title="用户名不能为空或只包含空格"
                required
                value={trialApplicationForm.username}
                onChange={(event) => updateTrialApplicationField("username", event.target.value)}
              />
            </label>
            <PasswordInput
              autoComplete="new-password"
              label="密码"
              maxLength={128}
              minLength={8}
              placeholder="至少 8 位"
              required
              value={trialApplicationForm.password}
              onChange={(event) => updateTrialApplicationField("password", event.target.value)}
            />
            <PasswordInput
              autoComplete="new-password"
              label="确认密码"
              maxLength={128}
              minLength={8}
              placeholder="再次输入密码"
              required
              value={trialPasswordConfirmation}
              onChange={(event) => {
                setTrialPasswordConfirmation(event.target.value);
                setTrialValidationError("");
              }}
            />
            <label className="auth-field">
              <span>手机号码</span>
              <input
                autoComplete="tel"
                inputMode="numeric"
                maxLength={11}
                pattern="1[3-9][0-9]{9}"
                placeholder="请输入11位手机号码"
                required
                title="请输入正确的11位手机号码"
                value={trialApplicationForm.phone}
                onChange={(event) => updateTrialApplicationField("phone", event.target.value)}
              />
            </label>
            <label className="auth-check auth-registration-consent">
              <input
                checked={registrationAgreementAccepted}
                required
                type="checkbox"
                onChange={(event) => {
                  setRegistrationAgreementAccepted(event.target.checked);
                  setTrialValidationError("");
                }}
              />
              <span>
                我已阅读并同意
                <a href="/terms" rel="noreferrer" target="_blank">《用户服务协议》</a>
                和
                <a href="/privacy" rel="noreferrer" target="_blank">《隐私政策》</a>
              </span>
            </label>
            {trialValidationError ? <p className="auth-status auth-status-error" role="alert">{trialValidationError}</p> : null}
            {trialApplicationMutation.isError ? <p className="auth-status auth-status-error" role="alert">{getErrorMessage(trialApplicationMutation.error)}</p> : null}
            <button className="auth-submit" disabled={trialApplicationMutation.isPending} type="submit">
              {trialApplicationMutation.isPending ? "正在创建…" : "创建账号"}
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
