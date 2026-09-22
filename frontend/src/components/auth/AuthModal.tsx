import { useMutation } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  checkRegistrationUsername,
  createTrialApplication,
  login,
  sendLoginSmsCode,
  sendRegistrationSmsCode
} from "@/api/auth";
import { ApiError } from "@/api/client";
import { ForgotPasswordFlow } from "@/components/auth/ForgotPasswordFlow";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PhoneInput } from "@/components/auth/PhoneInput";
import { useAuthStore } from "@/stores/useAuthStore";
import type { TrialApplicationPayload } from "@/types/auth";
import { createClientId } from "@/utils/id";

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.retryAfterSeconds) {
    return `${error.message}（约 ${error.retryAfterSeconds} 秒后可重试）`;
  }
  return error instanceof Error ? error.message : "登录失败，请稍后重试。";
}

interface AuthPanelProps {
  initialMode?: "login" | "trial-application";
  onAuthenticated: () => void;
}

type AuthMode = "login" | "forgot-password" | "trial-application";
type LoginMethod = "username" | "phone";
type RegistrationField = "username" | "password" | "passwordConfirmation" | "phone" | "verificationCode";
type UsernameAvailabilityStatus = "idle" | "checking" | "available" | "unavailable" | "error";

interface UsernameAvailabilityState {
  value: string;
  status: UsernameAvailabilityStatus;
  message: string;
}

const emptyTrialApplicationForm: TrialApplicationPayload = {
  username: "",
  password: "",
  phone: "",
  verification_code: ""
};

const untouchedRegistrationFields: Record<RegistrationField, boolean> = {
  username: false,
  password: false,
  passwordConfirmation: false,
  phone: false,
  verificationCode: false
};

const initialUsernameAvailability: UsernameAvailabilityState = {
  value: "",
  status: "idle",
  message: ""
};

const chinaMobilePhonePattern = /^1[3-9][0-9]{9}$/;

function getUsernameFormatError(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "请输入用户名。";
  if (cleaned.length > 64) return "用户名不能超过 64 个字符。";
  return "";
}

function getPasswordFormatError(value: string) {
  if (!value) return "请输入密码。";
  if (value.length < 8) return "密码至少需要 8 位。";
  return "";
}

function getPasswordConfirmationError(value: string, password: string) {
  if (!value) return "请再次输入密码。";
  if (value !== password) return "两次输入的密码不一致。";
  return "";
}

function getPhoneFormatError(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "请输入手机号码。";
  if (!chinaMobilePhonePattern.test(cleaned)) return "请输入正确的中国大陆 11 位手机号码。";
  return "";
}

function getVerificationCodeFormatError(value: string) {
  if (!value) return "请输入短信验证码。";
  if (!/^[0-9]{4,8}$/.test(value)) return "请输入 4～8 位数字验证码。";
  return "";
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function formatSmsCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}后重发`;
}

/** The single sign-in surface for the whole application. */
export function AuthPanel({ initialMode = "login", onAuthenticated }: AuthPanelProps) {
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("username");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [loginVerificationCode, setLoginVerificationCode] = useState("");
  const [loginSmsCountdown, setLoginSmsCountdown] = useState(0);
  const [loginSentSmsPhone, setLoginSentSmsPhone] = useState<string | null>(null);
  const [trialApplicationForm, setTrialApplicationForm] = useState<TrialApplicationPayload>(emptyTrialApplicationForm);
  const [trialPasswordConfirmation, setTrialPasswordConfirmation] = useState("");
  const [registrationFieldTouched, setRegistrationFieldTouched] = useState(untouchedRegistrationFields);
  const [usernameAvailability, setUsernameAvailability] = useState<UsernameAvailabilityState>(initialUsernameAvailability);
  const [registrationAgreementAccepted, setRegistrationAgreementAccepted] = useState(false);
  const [trialValidationError, setTrialValidationError] = useState("");
  const [trialApplicationSubmittedUsername, setTrialApplicationSubmittedUsername] = useState<string | null>(null);
  const [trialApplicationIdempotencyKey, setTrialApplicationIdempotencyKey] = useState(() => createClientId("registration"));
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [sentSmsPhone, setSentSmsPhone] = useState<string | null>(null);
  const [loginHelp, setLoginHelp] = useState("");
  const identityInputRef = useRef<HTMLInputElement>(null);
  const loginVerificationCodeInputRef = useRef<HTMLInputElement>(null);
  const trialUsernameInputRef = useRef<HTMLInputElement>(null);
  const verificationCodeInputRef = useRef<HTMLInputElement>(null);
  const trialApplicationFormRef = useRef<TrialApplicationPayload>(emptyTrialApplicationForm);
  const trialPasswordConfirmationRef = useRef("");
  const registrationAgreementAcceptedRef = useRef(false);
  const usernameAvailabilityRef = useRef<UsernameAvailabilityState>(initialUsernameAvailability);
  const usernameCheckRequestRef = useRef(0);
  const usernameCheckPromiseRef = useRef<{ value: string; promise: Promise<boolean> } | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => loginMethod === "phone"
      ? login({ phone: identity, verification_code: loginVerificationCode })
      : login({ identity, password }),
    onSuccess: (result) => {
      setAuthenticated(result.user, result.access_token);
      onAuthenticated();
    }
  });

  const trialApplicationMutation = useMutation({
    mutationFn: (payload: TrialApplicationPayload) => createTrialApplication(payload, trialApplicationIdempotencyKey),
    onSuccess: (result, submittedForm) => {
      setTrialApplicationSubmittedUsername(result.username);
      setLoginMethod("username");
      setIdentity(submittedForm.username);
      setPassword(submittedForm.password);
    }
  });

  const loginSmsMutation = useMutation({
    mutationFn: (phone: string) => sendLoginSmsCode(phone),
    onSuccess: (result, phone) => {
      setLoginSentSmsPhone(phone);
      setLoginSmsCountdown(result.retry_after_seconds);
      window.requestAnimationFrame(() => loginVerificationCodeInputRef.current?.focus());
    }
  });

  const registrationSmsMutation = useMutation({
    mutationFn: (phone: string) => sendRegistrationSmsCode(phone),
    onSuccess: (result, phone) => {
      setSentSmsPhone(phone);
      setSmsCountdown(result.retry_after_seconds);
      window.requestAnimationFrame(() => verificationCodeInputRef.current?.focus());
    }
  });

  function updateUsernameAvailability(nextState: UsernameAvailabilityState) {
    usernameAvailabilityRef.current = nextState;
    setUsernameAvailability(nextState);
  }

  function resetUsernameAvailability() {
    usernameCheckRequestRef.current += 1;
    usernameCheckPromiseRef.current = null;
    updateUsernameAvailability(initialUsernameAvailability);
  }

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setTimeout(() => setSmsCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [smsCountdown]);

  useEffect(() => {
    if (loginSmsCountdown <= 0) return;
    const timer = window.setTimeout(
      () => setLoginSmsCountdown((current) => Math.max(0, current - 1)),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [loginSmsCountdown]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (mode === "login") identityInputRef.current?.focus();
      else if (mode === "trial-application") trialUsernameInputRef.current?.focus();
    });
  }, [mode]);

  function switchToLogin() {
    if (hasUnsavedRegistration() && !window.confirm("注册信息尚未提交，确认放弃并返回登录？")) return;
    loginMutation.reset();
    loginSmsMutation.reset();
    trialApplicationMutation.reset();
    registrationSmsMutation.reset();
    setSmsCountdown(0);
    setSentSmsPhone(null);
    setTrialApplicationSubmittedUsername(null);
    setTrialValidationError("");
    setMode("login");
  }

  function switchLoginMethod(nextMethod: LoginMethod) {
    if (nextMethod === loginMethod) return;
    loginMutation.reset();
    loginSmsMutation.reset();
    setLoginHelp("");
    setIdentity("");
    setPassword("");
    setLoginVerificationCode("");
    setLoginSmsCountdown(0);
    setLoginSentSmsPhone(null);
    setLoginMethod(nextMethod);
  }

  function switchToTrialApplication() {
    loginMutation.reset();
    loginSmsMutation.reset();
    trialApplicationMutation.reset();
    registrationSmsMutation.reset();
    setSmsCountdown(0);
    setSentSmsPhone(null);
    setTrialApplicationSubmittedUsername(null);
    setTrialValidationError("");
    setRegistrationFieldTouched(untouchedRegistrationFields);
    setMode("trial-application");
  }

  function updateTrialApplicationField(field: keyof TrialApplicationPayload, value: string) {
    const phoneChanged = field === "phone" && trialApplicationFormRef.current.phone !== value;
    const nextForm = {
      ...trialApplicationFormRef.current,
      [field]: value,
      ...(phoneChanged ? { verification_code: "" } : {})
    };
    trialApplicationFormRef.current = nextForm;
    setTrialApplicationForm(nextForm);
    if (field === "username") resetUsernameAvailability();
    if (phoneChanged) {
      setRegistrationFieldTouched((current) => ({ ...current, verificationCode: false }));
    }
    if (field === "phone" && sentSmsPhone && value.trim() !== sentSmsPhone) {
      registrationSmsMutation.reset();
      setSmsCountdown(0);
      setSentSmsPhone(null);
    }
    setTrialValidationError("");
  }

  function markRegistrationFieldTouched(field: RegistrationField) {
    setRegistrationFieldTouched((current) => ({ ...current, [field]: true }));
  }

  function validateUsernameAvailability(rawUsername: string): Promise<boolean> {
    const cleanedUsername = rawUsername.trim();
    const formatError = getUsernameFormatError(cleanedUsername);
    if (formatError) return Promise.resolve(false);

    const normalizedUsername = cleanedUsername.toLowerCase();
    const currentAvailability = usernameAvailabilityRef.current;
    if (currentAvailability.value === normalizedUsername) {
      if (currentAvailability.status === "available") return Promise.resolve(true);
      if (currentAvailability.status === "unavailable") return Promise.resolve(false);
      if (
        currentAvailability.status === "checking"
        && usernameCheckPromiseRef.current?.value === normalizedUsername
      ) {
        return usernameCheckPromiseRef.current.promise;
      }
    }

    const requestId = ++usernameCheckRequestRef.current;
    updateUsernameAvailability({
      value: normalizedUsername,
      status: "checking",
      message: "正在检测用户名…"
    });

    const request = checkRegistrationUsername(cleanedUsername)
      .then((result) => {
        if (
          requestId === usernameCheckRequestRef.current
          && trialApplicationFormRef.current.username.trim().toLowerCase() === normalizedUsername
        ) {
          updateUsernameAvailability({
            value: normalizedUsername,
            status: result.available ? "available" : "unavailable",
            message: result.available ? "用户名可用。" : "用户名已存在，请更换用户名。"
          });
        }
        return result.available;
      })
      .catch(() => {
        if (
          requestId === usernameCheckRequestRef.current
          && trialApplicationFormRef.current.username.trim().toLowerCase() === normalizedUsername
        ) {
          updateUsernameAvailability({
            value: normalizedUsername,
            status: "error",
            message: "暂时无法检测用户名，请稍后重试。"
          });
        }
        return false;
      })
      .finally(() => {
        if (
          requestId === usernameCheckRequestRef.current
          && usernameCheckPromiseRef.current?.value === normalizedUsername
        ) {
          usernameCheckPromiseRef.current = null;
        }
      });

    usernameCheckPromiseRef.current = { value: normalizedUsername, promise: request };
    return request;
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginHelp("");
    loginMutation.mutate();
  }

  function handleSendLoginSmsCode() {
    const phone = identity.trim();
    if (getPhoneFormatError(phone)) return;
    loginSmsMutation.reset();
    loginMutation.reset();
    setLoginHelp("");
    loginSmsMutation.mutate(phone);
  }

  function handleSendRegistrationSmsCode() {
    const phone = trialApplicationFormRef.current.phone.trim();
    markRegistrationFieldTouched("phone");
    if (getPhoneFormatError(phone)) return;
    registrationSmsMutation.reset();
    setTrialValidationError("");
    registrationSmsMutation.mutate(phone);
  }

  async function handleTrialApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationFieldTouched({
      username: true,
      password: true,
      passwordConfirmation: true,
      phone: true,
      verificationCode: true
    });

    const currentForm = trialApplicationFormRef.current;
    if (
      getUsernameFormatError(currentForm.username)
      || getPasswordFormatError(currentForm.password)
      || getPasswordConfirmationError(trialPasswordConfirmationRef.current, currentForm.password)
      || getPhoneFormatError(currentForm.phone)
      || getVerificationCodeFormatError(currentForm.verification_code)
    ) {
      setTrialValidationError("");
      return;
    }

    if (!registrationAgreementAcceptedRef.current) {
      setTrialValidationError("请先阅读并同意《用户服务协议》和《隐私政策》。");
      return;
    }

    const usernameIsAvailable = await validateUsernameAvailability(currentForm.username);
    if (
      !usernameIsAvailable
      || trialApplicationFormRef.current.username.trim().toLowerCase() !== currentForm.username.trim().toLowerCase()
    ) return;

    const latestForm = trialApplicationFormRef.current;
    if (
      getPasswordFormatError(latestForm.password)
      || getPasswordConfirmationError(trialPasswordConfirmationRef.current, latestForm.password)
      || getPhoneFormatError(latestForm.phone)
      || getVerificationCodeFormatError(latestForm.verification_code)
    ) {
      return;
    }
    if (!registrationAgreementAcceptedRef.current) {
      setTrialValidationError("请先阅读并同意《用户服务协议》和《隐私政策》。");
      return;
    }
    setTrialValidationError("");
    trialApplicationMutation.mutate(latestForm);
  }

  function hasUnsavedRegistration() {
    return mode === "trial-application"
      && !trialApplicationSubmittedUsername
      && (
        Object.values(trialApplicationForm).some((value) => value.trim())
        || Boolean(trialPasswordConfirmation)
      );
  }

  const isTrialApplicationSuccess = mode === "trial-application" && Boolean(trialApplicationSubmittedUsername);
  const loginInlineMessage = loginMutation.isError ? getErrorMessage(loginMutation.error) : loginHelp;
  const loginSmsFeedback = loginSmsMutation.isError
    ? getErrorMessage(loginSmsMutation.error)
    : loginSentSmsPhone === identity.trim()
      ? `验证码已发送至 ${maskPhone(loginSentSmsPhone)}。`
      : "";
  const loginSmsFeedbackTone = loginSmsMutation.isError ? "error" : "success";
  const usernameFormatError = registrationFieldTouched.username
    ? getUsernameFormatError(trialApplicationForm.username)
    : "";
  const usernameFeedback = usernameFormatError || usernameAvailability.message;
  const usernameFeedbackTone = usernameFormatError
    || usernameAvailability.status === "unavailable"
    || usernameAvailability.status === "error"
    ? "error"
    : usernameAvailability.status === "available"
      ? "success"
      : "info";
  const trialPasswordFormatError = registrationFieldTouched.password
    ? getPasswordFormatError(trialApplicationForm.password)
    : "";
  const trialPasswordConfirmationError = registrationFieldTouched.passwordConfirmation
    ? getPasswordConfirmationError(trialPasswordConfirmation, trialApplicationForm.password)
    : "";
  const trialPhoneFormatError = registrationFieldTouched.phone
    ? getPhoneFormatError(trialApplicationForm.phone)
    : "";
  const trialVerificationCodeFormatError = registrationFieldTouched.verificationCode
    ? getVerificationCodeFormatError(trialApplicationForm.verification_code)
    : "";
  const smsFeedback = trialVerificationCodeFormatError
    || (registrationSmsMutation.isError
      ? getErrorMessage(registrationSmsMutation.error)
      : sentSmsPhone === trialApplicationForm.phone.trim()
        ? `验证码已发送至 ${maskPhone(sentSmsPhone)}。`
        : "");
  const smsFeedbackTone = trialVerificationCodeFormatError || registrationSmsMutation.isError
    ? "error"
    : "success";
  const trialFormFeedback = trialValidationError
    || (trialApplicationMutation.isError ? getErrorMessage(trialApplicationMutation.error) : "");

  return (
    <section
      aria-label={isTrialApplicationSuccess ? "账号创建成功" : undefined}
      aria-labelledby={isTrialApplicationSuccess ? undefined : "auth-title"}
      className={`auth-dialog auth-page-panel ${mode === "login" ? "auth-login-dialog" : mode === "forgot-password" ? "forgot-password-dialog" : "trial-application-dialog"} ${isTrialApplicationSuccess ? "auth-success-dialog" : ""}`}
    >
        {!isTrialApplicationSuccess ? (
          <div className="auth-dialog-heading auth-dialog-brand-heading">
            <h2 id="auth-title" className="auth-system-brand">
              欢迎使用外墙巡检平台
            </h2>
          </div>
        ) : null}
        {mode === "login" ? (
          <form className="auth-form auth-login-form" onSubmit={handleLoginSubmit}>
            <div aria-label="登录方式" className="auth-login-tabs" role="tablist">
              <button
                aria-selected={loginMethod === "username"}
                className={`auth-login-tab ${loginMethod === "username" ? "is-active" : ""}`}
                disabled={loginMutation.isPending}
                id="username-login-tab"
                role="tab"
                type="button"
                onClick={() => switchLoginMethod("username")}
              >
                用户名登录
              </button>
              <button
                aria-selected={loginMethod === "phone"}
                className={`auth-login-tab ${loginMethod === "phone" ? "is-active" : ""}`}
                disabled={loginMutation.isPending}
                id="phone-login-tab"
                role="tab"
                type="button"
                onClick={() => switchLoginMethod("phone")}
              >
                手机号登录
              </button>
            </div>
            <label className="auth-field">
              <span>{loginMethod === "phone" ? "手机号" : "用户名"}</span>
              {loginMethod === "phone" ? (
                <PhoneInput
                  ref={identityInputRef}
                  aria-label="手机号"
                  autoComplete="tel"
                  inputMode="numeric"
                  maxLength={11}
                  pattern="1[3-9][0-9]{9}"
                  placeholder="请输入11位手机号码"
                  required
                  title="请输入正确的11位手机号码"
                  value={identity}
                  onChange={(event) => {
                    const nextPhone = event.target.value.replace(/\D/g, "");
                    setIdentity(nextPhone);
                    setLoginVerificationCode("");
                    if (loginSentSmsPhone && nextPhone !== loginSentSmsPhone) {
                      loginSmsMutation.reset();
                      setLoginSmsCountdown(0);
                      setLoginSentSmsPhone(null);
                    }
                    if (loginMutation.isError) loginMutation.reset();
                  }}
                />
              ) : (
                <input
                  ref={identityInputRef}
                  aria-label="用户名"
                  autoComplete="username"
                  maxLength={64}
                  pattern=".*\S.*"
                  placeholder="请输入用户名"
                  required
                  title="请输入用户名"
                  value={identity}
                  onChange={(event) => {
                    setIdentity(event.target.value);
                    if (loginMutation.isError) loginMutation.reset();
                  }}
                />
              )}
            </label>
            {loginMethod === "phone" ? (
              <div className="auth-field auth-login-verification-field">
                <label className="auth-field-label" htmlFor="login-verification-code">短信验证码</label>
                <div className="auth-verification-code-row">
                  <input
                    ref={loginVerificationCodeInputRef}
                    aria-describedby={loginSmsFeedback ? "login-verification-code-feedback" : undefined}
                    autoComplete="one-time-code"
                    id="login-verification-code"
                    inputMode="numeric"
                    maxLength={8}
                    minLength={4}
                    pattern="[0-9]{4,8}"
                    placeholder="请输入验证码"
                    required
                    value={loginVerificationCode}
                    onChange={(event) => {
                      setLoginVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8));
                      if (loginMutation.isError) loginMutation.reset();
                    }}
                  />
                  <button
                    className="auth-verification-code-button"
                    disabled={
                      loginSmsMutation.isPending
                      || loginSmsCountdown > 0
                      || Boolean(getPhoneFormatError(identity))
                    }
                    type="button"
                    onClick={handleSendLoginSmsCode}
                  >
                    {loginSmsMutation.isPending
                      ? "发送中…"
                      : loginSmsCountdown > 0
                        ? formatSmsCountdown(loginSmsCountdown)
                        : "获取验证码"}
                  </button>
                </div>
                <small
                  aria-hidden={loginSmsFeedback ? undefined : true}
                  className={`auth-field-feedback is-${loginSmsFeedbackTone} ${loginSmsFeedback ? "" : "is-empty"}`}
                  id="login-verification-code-feedback"
                  role={loginSmsFeedback ? (loginSmsFeedbackTone === "error" ? "alert" : "status") : undefined}
                >
                  {loginSmsFeedback || "\u00a0"}
                </small>
                {loginInlineMessage ? (
                  <span
                    className={`auth-login-inline-message ${loginMutation.isError ? "is-error" : loginHelp ? "is-success" : "is-info"}`}
                    role={loginMutation.isError ? "alert" : "status"}
                  >
                    {loginInlineMessage}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="auth-password-field">
                <PasswordInput
                  aria-label="密码"
                  autoComplete="current-password"
                  label="密码"
                  placeholder="请输入密码"
                  required
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (loginMutation.isError) loginMutation.reset();
                  }}
                />
                <div className="auth-login-assistance-row">
                  {loginInlineMessage ? (
                    <span
                      className={`auth-login-inline-message ${loginMutation.isError ? "is-error" : loginHelp ? "is-success" : "is-info"}`}
                      role={loginMutation.isError ? "alert" : "status"}
                    >
                      {loginInlineMessage}
                    </span>
                  ) : null}
                  <button
                    className="auth-link-button auth-forgot-password"
                    type="button"
                    onClick={() => {
                      loginMutation.reset();
                      setLoginHelp("");
                      setMode("forgot-password");
                    }}
                  >
                    忘记密码
                  </button>
                </div>
              </div>
            )}
            <button className="auth-submit" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? "正在登录…" : "登录"}
            </button>
            <div className="auth-switch-row">
              <span>还没有账号？</span>
              <button className="auth-link-button" disabled={loginMutation.isPending} type="button" onClick={switchToTrialApplication}>
                注册账号
              </button>
            </div>
          </form>
        ) : mode === "forgot-password" ? (
          <ForgotPasswordFlow
            onBack={switchToLogin}
            onPasswordReset={(phone) => {
              setLoginMethod("phone");
              setIdentity(phone);
              setPassword("");
              setLoginVerificationCode("");
              setLoginHelp("密码已重置，可使用手机号验证码登录。");
            }}
          />
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
          <form className="auth-form" noValidate onSubmit={handleTrialApplicationSubmit}>
            <label className="auth-field">
              <span>用户名</span>
              <input
                ref={trialUsernameInputRef}
                aria-busy={usernameAvailability.status === "checking"}
                aria-describedby={usernameFeedback ? "registration-username-feedback" : undefined}
                aria-invalid={usernameFeedbackTone === "error" || undefined}
                autoComplete="username"
                maxLength={64}
                placeholder="用于后续登录"
                pattern=".*\S.*"
                title="用户名不能为空或只包含空格"
                required
                value={trialApplicationForm.username}
                onChange={(event) => updateTrialApplicationField("username", event.target.value)}
                onBlur={() => {
                  markRegistrationFieldTouched("username");
                  void validateUsernameAvailability(trialApplicationFormRef.current.username);
                }}
              />
              <small
                aria-hidden={usernameFeedback ? undefined : true}
                className={`auth-field-feedback is-${usernameFeedbackTone} ${usernameFeedback ? "" : "is-empty"}`}
                id="registration-username-feedback"
                role={usernameFeedback ? (usernameFeedbackTone === "error" ? "alert" : "status") : undefined}
              >
                {usernameFeedback || "\u00a0"}
              </small>
            </label>
            <div className="auth-registration-field-group">
              <PasswordInput
                aria-describedby={trialPasswordFormatError ? "registration-password-feedback" : undefined}
                aria-invalid={Boolean(trialPasswordFormatError) || undefined}
                autoComplete="new-password"
                label="密码"
                maxLength={128}
                minLength={8}
                placeholder="至少 8 位"
                required
                value={trialApplicationForm.password}
                onBlur={() => markRegistrationFieldTouched("password")}
                onChange={(event) => updateTrialApplicationField("password", event.target.value)}
              />
              <small
                aria-hidden={trialPasswordFormatError ? undefined : true}
                className={`auth-field-feedback is-error ${trialPasswordFormatError ? "" : "is-empty"}`}
                id="registration-password-feedback"
                role={trialPasswordFormatError ? "alert" : undefined}
              >
                {trialPasswordFormatError || "\u00a0"}
              </small>
            </div>
            <div className="auth-registration-field-group">
              <PasswordInput
                aria-describedby={trialPasswordConfirmationError ? "registration-password-confirmation-feedback" : undefined}
                aria-invalid={Boolean(trialPasswordConfirmationError) || undefined}
                autoComplete="new-password"
                label="确认密码"
                maxLength={128}
                minLength={8}
                placeholder="再次输入密码"
                required
                value={trialPasswordConfirmation}
                onBlur={() => markRegistrationFieldTouched("passwordConfirmation")}
                onChange={(event) => {
                  trialPasswordConfirmationRef.current = event.target.value;
                  setTrialPasswordConfirmation(event.target.value);
                  setTrialValidationError("");
                }}
              />
              <small
                aria-hidden={trialPasswordConfirmationError ? undefined : true}
                className={`auth-field-feedback is-error ${trialPasswordConfirmationError ? "" : "is-empty"}`}
                id="registration-password-confirmation-feedback"
                role={trialPasswordConfirmationError ? "alert" : undefined}
              >
                {trialPasswordConfirmationError || "\u00a0"}
              </small>
            </div>
            <label className="auth-field">
              <span>手机号码</span>
              <PhoneInput
                aria-describedby={trialPhoneFormatError ? "registration-phone-feedback" : undefined}
                aria-invalid={Boolean(trialPhoneFormatError) || undefined}
                autoComplete="tel"
                inputMode="numeric"
                maxLength={11}
                pattern="1[3-9][0-9]{9}"
                placeholder="请输入11位手机号码"
                required
                title="请输入正确的11位手机号码"
                value={trialApplicationForm.phone}
                onChange={(event) => updateTrialApplicationField("phone", event.target.value.replace(/\D/g, ""))}
                onBlur={() => markRegistrationFieldTouched("phone")}
              />
              <small
                aria-hidden={trialPhoneFormatError ? undefined : true}
                className={`auth-field-feedback is-error ${trialPhoneFormatError ? "" : "is-empty"}`}
                id="registration-phone-feedback"
                role={trialPhoneFormatError ? "alert" : undefined}
              >
                {trialPhoneFormatError || "\u00a0"}
              </small>
            </label>
            <div className="auth-field auth-registration-verification-field">
              <label className="auth-field-label" htmlFor="registration-verification-code">短信验证码</label>
              <div className="auth-verification-code-row">
                <input
                  ref={verificationCodeInputRef}
                  aria-describedby={smsFeedback ? "registration-verification-code-feedback" : undefined}
                  aria-invalid={smsFeedbackTone === "error" || undefined}
                  autoComplete="one-time-code"
                  id="registration-verification-code"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="请输入验证码"
                  required
                  value={trialApplicationForm.verification_code}
                  onBlur={() => markRegistrationFieldTouched("verificationCode")}
                  onChange={(event) => updateTrialApplicationField(
                    "verification_code",
                    event.target.value.replace(/\D/g, "").slice(0, 8)
                  )}
                />
                <button
                  className="auth-verification-code-button"
                  disabled={
                    registrationSmsMutation.isPending
                    || smsCountdown > 0
                    || Boolean(getPhoneFormatError(trialApplicationForm.phone))
                  }
                  type="button"
                  onClick={handleSendRegistrationSmsCode}
                >
                  {registrationSmsMutation.isPending
                    ? "发送中…"
                    : smsCountdown > 0
                      ? formatSmsCountdown(smsCountdown)
                      : "获取验证码"}
                </button>
              </div>
              <small
                aria-hidden={smsFeedback ? undefined : true}
                className={`auth-field-feedback is-${smsFeedbackTone} ${smsFeedback ? "" : "is-empty"}`}
                id="registration-verification-code-feedback"
                role={smsFeedback ? (smsFeedbackTone === "error" ? "alert" : "status") : undefined}
              >
                {smsFeedback || "\u00a0"}
              </small>
            </div>
            <label className="auth-check auth-registration-consent">
              <input
                checked={registrationAgreementAccepted}
                required
                type="checkbox"
                onChange={(event) => {
                  registrationAgreementAcceptedRef.current = event.target.checked;
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
            <p
              aria-hidden={trialFormFeedback ? undefined : true}
              className={`auth-status auth-status-error auth-registration-form-feedback ${trialFormFeedback ? "" : "is-empty"}`}
              role={trialFormFeedback ? "alert" : undefined}
              title={trialFormFeedback || undefined}
            >
              {trialFormFeedback || "\u00a0"}
            </p>
            <button
              className="auth-submit"
              disabled={
                trialApplicationMutation.isPending
                || registrationSmsMutation.isPending
                || usernameAvailability.status === "checking"
              }
              type="submit"
            >
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
  );
}
