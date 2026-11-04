import { useMutation } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  resetPassword,
  sendPasswordResetSmsCode,
  verifyPasswordResetCode
} from "@/api/auth";
import { ApiError } from "@/api/client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PhoneInput } from "@/components/auth/PhoneInput";

interface ForgotPasswordFlowProps {
  onBack: () => void;
  onPasswordReset: (phone: string) => void;
}

type ForgotPasswordStage = "verify" | "reset" | "success";
type ValidationErrorField = "phone" | "verificationCode" | "newPassword" | "confirmPassword" | "form";

const chinaMobilePhonePattern = /^1[3-9][0-9]{9}$/;

function getPhoneFormatError(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "请输入绑定的手机号码。";
  if (!chinaMobilePhonePattern.test(cleaned)) return "请输入正确的中国大陆 11 位手机号码。";
  return "";
}

function getVerificationCodeFormatError(value: string) {
  if (!value) return "请输入短信验证码。";
  if (!/^[0-9]{4,8}$/.test(value)) return "请输入 4～8 位数字验证码。";
  return "";
}

function getPasswordFormatError(value: string) {
  if (!value) return "请输入新密码。";
  if (value.length < 8) return "密码至少需要 8 位。";
  return "";
}

function getPasswordConfirmationError(value: string, password: string) {
  if (!value) return "请再次输入新密码。";
  if (value !== password) return "两次输入的新密码不一致。";
  return "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.retryAfterSeconds) {
    return `${error.message}（约 ${error.retryAfterSeconds} 秒后可重试）`;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function ForgotPasswordFlow({ onBack, onPasswordReset }: ForgotPasswordFlowProps) {
  const [stage, setStage] = useState<ForgotPasswordStage>("verify");
  const [phone, setPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [sentSmsPhone, setSentSmsPhone] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const [validationErrorField, setValidationErrorField] = useState<ValidationErrorField>("form");
  const [resetFieldTouched, setResetFieldTouched] = useState({
    newPassword: false,
    confirmPassword: false
  });
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const verificationCodeInputRef = useRef<HTMLInputElement>(null);
  const newPasswordInputRef = useRef<HTMLInputElement>(null);

  const smsMutation = useMutation({
    mutationFn: (submittedPhone: string) => sendPasswordResetSmsCode(submittedPhone),
    onSuccess: (result, submittedPhone) => {
      setSentSmsPhone(submittedPhone);
      setSmsCountdown(result.retry_after_seconds);
      clearValidationError();
      window.requestAnimationFrame(() => verificationCodeInputRef.current?.focus());
    }
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyPasswordResetCode({
      phone: phone.trim(),
      verification_code: verificationCode.trim()
    }),
    onSuccess: (result) => {
      setResetToken(result.reset_token);
      setStage("reset");
      setResetFieldTouched({ newPassword: false, confirmPassword: false });
      clearValidationError();
    }
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPassword({
      reset_token: resetToken ?? "",
      new_password: newPassword
    }),
    onSuccess: () => {
      onPasswordReset(phone.trim());
      clearValidationError();
      setStage("success");
    }
  });

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setTimeout(() => setSmsCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [smsCountdown]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (stage === "verify") phoneInputRef.current?.focus();
      else if (stage === "reset") newPasswordInputRef.current?.focus();
    });
  }, [stage]);

  function handleBack() {
    if (smsMutation.isPending || verifyMutation.isPending || resetMutation.isPending) return;
    onBack();
  }

  function clearValidationError() {
    setValidationError("");
    setValidationErrorField("form");
  }

  function showValidationError(message: string, field: ValidationErrorField) {
    setValidationError(message);
    setValidationErrorField(field);
  }

  function markResetFieldTouched(field: "newPassword" | "confirmPassword") {
    setResetFieldTouched((current) => ({ ...current, [field]: true }));
  }

  function handleSendSmsCode() {
    const cleanedPhone = phone.trim();
    const formatError = getPhoneFormatError(cleanedPhone);
    if (formatError) {
      showValidationError(formatError, "phone");
      return;
    }
    smsMutation.reset();
    clearValidationError();
    smsMutation.mutate(cleanedPhone);
  }

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phoneError = getPhoneFormatError(phone);
    const codeError = getVerificationCodeFormatError(verificationCode.trim());
    if (phoneError || codeError) {
      showValidationError(phoneError || codeError, phoneError ? "phone" : "verificationCode");
      return;
    }
    clearValidationError();
    verifyMutation.mutate();
  }

  function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetToken) {
      showValidationError("验证状态已失效，请重新获取验证码。", "form");
      setStage("verify");
      return;
    }
    const passwordError = getPasswordFormatError(newPassword);
    const confirmationError = getPasswordConfirmationError(confirmPassword, newPassword);
    if (passwordError || confirmationError) {
      setResetFieldTouched({ newPassword: true, confirmPassword: true });
      showValidationError(passwordError || confirmationError, passwordError ? "newPassword" : "confirmPassword");
      return;
    }
    clearValidationError();
    resetMutation.mutate();
  }

  const mutationError = stage === "verify"
    ? (smsMutation.isError ? getErrorMessage(smsMutation.error) : verifyMutation.isError ? getErrorMessage(verifyMutation.error) : "")
    : (resetMutation.isError ? getErrorMessage(resetMutation.error) : "");
  const error = validationError || mutationError;
  const isPending = smsMutation.isPending || verifyMutation.isPending || resetMutation.isPending;
  const resetPasswordFormatError = resetFieldTouched.newPassword
    ? getPasswordFormatError(newPassword)
    : "";
  const resetPasswordConfirmationError = resetFieldTouched.confirmPassword
    ? getPasswordConfirmationError(confirmPassword, newPassword)
    : "";

  if (stage === "success") {
    return (
      <div className="auth-form auth-success-panel" role="status">
        <span className="auth-success-icon" aria-hidden="true">
          <CircleCheck />
        </span>
        <div className="auth-flow-heading">
          <h3>密码设置成功</h3>
          <p>请点击下方按钮返回登录。</p>
        </div>
        <button className="auth-submit" type="button" onClick={onBack}>
          返回登录
        </button>
      </div>
    );
  }

  if (stage === "reset") {
    return (
      <form className="auth-form auth-forgot-form auth-forgot-reset-form" noValidate onSubmit={handleReset}>
        <div className="auth-forgot-reset-field-group">
          <PasswordInput
            ref={newPasswordInputRef}
            aria-describedby={resetPasswordFormatError ? "forgot-password-new-password-feedback" : undefined}
            aria-invalid={Boolean(resetPasswordFormatError) || undefined}
            autoComplete="new-password"
            label="新密码"
            maxLength={128}
            minLength={8}
            placeholder="至少 8 位"
            required
            value={newPassword}
            onBlur={() => markResetFieldTouched("newPassword")}
            onChange={(event) => {
              setNewPassword(event.target.value);
              clearValidationError();
              resetMutation.reset();
            }}
          />
          <small
            aria-hidden={resetPasswordFormatError ? undefined : true}
            className={`auth-field-feedback is-error ${resetPasswordFormatError ? "" : "is-empty"}`}
            id="forgot-password-new-password-feedback"
            role={resetPasswordFormatError ? "alert" : undefined}
          >
            {resetPasswordFormatError || "\u00a0"}
          </small>
        </div>
        <div className="auth-forgot-reset-field-group">
          <PasswordInput
            aria-describedby={resetPasswordConfirmationError ? "forgot-password-confirm-password-feedback" : undefined}
            aria-invalid={Boolean(resetPasswordConfirmationError) || undefined}
            autoComplete="new-password"
            label="确认新密码"
            maxLength={128}
            minLength={8}
            placeholder="再次输入新密码"
            required
            value={confirmPassword}
            onBlur={() => markResetFieldTouched("confirmPassword")}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              clearValidationError();
              resetMutation.reset();
            }}
          />
          <small
            aria-hidden={resetPasswordConfirmationError ? undefined : true}
            className={`auth-field-feedback is-error ${resetPasswordConfirmationError ? "" : "is-empty"}`}
            id="forgot-password-confirm-password-feedback"
            role={resetPasswordConfirmationError ? "alert" : undefined}
          >
            {resetPasswordConfirmationError || "\u00a0"}
          </small>
        </div>
        {(validationErrorField === "form" || resetMutation.isError) && error ? (
          <p className="auth-status auth-status-error" role="alert">{error}</p>
        ) : null}
        <button className="auth-submit" disabled={isPending} type="submit">
          {resetMutation.isPending ? "正在保存…" : "设置新密码"}
        </button>
      </form>
    );
  }

  const sentMessage = sentSmsPhone === phone.trim()
    ? `验证码已发送至 ${maskPhone(sentSmsPhone)}，有效期内可完成验证。`
    : "";
  const verificationCodeFeedback = validationErrorField === "verificationCode"
    ? validationError
    : validationErrorField === "phone"
      ? ""
      : mutationError;

  return (
    <form className="auth-form auth-forgot-form auth-forgot-verify-form" noValidate onSubmit={handleVerify}>
      <label className="auth-field">
        <span>绑定手机号</span>
        <PhoneInput
          ref={phoneInputRef}
          autoComplete="tel"
          inputMode="tel"
          maxLength={11}
          placeholder="请输入手机号"
          required
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value.replace(/\D/g, ""));
            setSentSmsPhone(null);
            clearValidationError();
            smsMutation.reset();
            verifyMutation.reset();
          }}
        />
      </label>
      <div className="auth-field">
        <span>短信验证码</span>
        <div className="auth-verification-code-row">
          <input
            ref={verificationCodeInputRef}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={8}
            placeholder="请输入验证码"
            required
            value={verificationCode}
            onChange={(event) => {
              setVerificationCode(event.target.value.replace(/\D/g, ""));
              clearValidationError();
              verifyMutation.reset();
            }}
          />
          <button
            className="auth-verification-code-button"
            disabled={smsCountdown > 0 || smsMutation.isPending || verifyMutation.isPending}
            type="button"
            onClick={handleSendSmsCode}
          >
            {smsMutation.isPending ? "发送中…" : smsCountdown > 0 ? `${smsCountdown}s 后重发` : "获取验证码"}
          </button>
        </div>
        <small
          aria-hidden={verificationCodeFeedback || sentMessage ? undefined : true}
          className={`auth-field-feedback ${verificationCodeFeedback ? "is-error" : sentMessage ? "is-success" : "is-empty"}`}
          id="forgot-password-verification-code-feedback"
          role={verificationCodeFeedback ? "alert" : sentMessage ? "status" : undefined}
        >
          {verificationCodeFeedback || sentMessage || "\u00a0"}
        </small>
      </div>
      {validationErrorField === "phone" && error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
      <button className="auth-submit" disabled={isPending} type="submit">
        {verifyMutation.isPending ? "验证中…" : "验证并继续"}
      </button>
      <div className="auth-switch-row">
        <button className="auth-link-button" disabled={isPending} type="button" onClick={handleBack}>返回登录</button>
      </div>
    </form>
  );
}
