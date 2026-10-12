import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { changePassword } from "@/api/auth";
import { ApiError } from "@/api/client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ErrorNoticeModal } from "@/components/project/PhotoLimitModal";

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && typeof error.payload === "object" && error.payload !== null && "detail" in error.payload) {
    return String((error.payload as { detail: unknown }).detail);
  }
  return error instanceof Error ? error.message : "修改密码失败，请稍后重试。";
}

function isCurrentPasswordIncorrectError(error: unknown) {
  return getErrorMessage(error) === "当前密码不正确。";
}

function getNewPasswordError(value: string, currentPassword: string) {
  if (!value) return "请输入新密码。";
  if (value.length < 8) return "密码至少需要 8 位。";
  if (value === currentPassword) return "新密码不能与当前密码相同。";
  return "";
}

function getConfirmPasswordError(value: string, newPassword: string) {
  if (!value) return "请再次输入新密码。";
  if (value !== newPassword) return "两次输入的新密码不一致。";
  return "";
}

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasswordChanged: () => void;
}

export function ChangePasswordModal({ isOpen, onClose, onPasswordChanged }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorNotice, setErrorNotice] = useState("");
  const [validationError, setValidationError] = useState("");
  const [touched, setTouched] = useState({ newPassword: false, confirmPassword: false });

  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      onClose();
      onPasswordChanged();
    },
    onError: (error) => {
      if (isCurrentPasswordIncorrectError(error)) {
        setErrorNotice(getErrorMessage(error));
      }
    }
  });

  useEffect(() => {
    if (isOpen) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrorNotice("");
    setValidationError("");
    setTouched({ newPassword: false, confirmPassword: false });
    changePasswordMutation.reset();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    document.body.classList.add("auth-modal-open");

    return () => {
      document.body.classList.remove("auth-modal-open");
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || errorNotice) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [changePasswordMutation.isPending, confirmPassword, currentPassword, errorNotice, isOpen, newPassword, onClose]);

  function closeModal() {
    if (changePasswordMutation.isPending) return;
    const hasInput = Boolean(currentPassword || newPassword || confirmPassword);
    if (hasInput && !window.confirm("密码修改尚未提交，确认放弃？")) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ newPassword: true, confirmPassword: true });
    if (!currentPassword) {
      setValidationError("请输入当前密码。");
      return;
    }
    if (getNewPasswordError(newPassword, currentPassword) || getConfirmPasswordError(confirmPassword, newPassword)) return;
    setValidationError("");
    changePasswordMutation.mutate();
  }

  if (!isOpen) return null;

  const mutationError = changePasswordMutation.isError && !isCurrentPasswordIncorrectError(changePasswordMutation.error)
    ? getErrorMessage(changePasswordMutation.error)
    : "";
  const error = validationError || mutationError;
  const newPasswordError = touched.newPassword ? getNewPasswordError(newPassword, currentPassword) : "";
  const confirmPasswordError = touched.confirmPassword ? getConfirmPasswordError(confirmPassword, newPassword) : "";

  return (
    <div aria-labelledby="change-password-title" aria-modal="true" className="auth-modal change-password-modal is-open" role="dialog">
      <div aria-hidden="true" className="auth-modal-backdrop" />
      <section className="auth-dialog">
        <button aria-label="关闭修改密码弹窗" className="auth-close back-cancel-button" disabled={changePasswordMutation.isPending} type="button" onClick={closeModal}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <h2 id="change-password-title">修改密码</h2>
        </div>
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <PasswordInput
            autoComplete="current-password"
            floatingLabel
            label="当前密码"
            maxLength={128}
            placeholder=" "
            required
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              setValidationError("");
            }}
          />
          <PasswordInput
            autoComplete="new-password"
            errorMessage={newPasswordError}
            floatingLabel
            label="新密码"
            maxLength={128}
            minLength={8}
            placeholder=" "
            required
            value={newPassword}
            onBlur={() => setTouched((current) => ({ ...current, newPassword: true }))}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setValidationError("");
            }}
          />
          <PasswordInput
            autoComplete="new-password"
            errorMessage={confirmPasswordError}
            floatingLabel
            label="确认新密码"
            maxLength={128}
            minLength={8}
            placeholder=" "
            required
            value={confirmPassword}
            onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setValidationError("");
            }}
          />
          {error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
          <button className="button primary-action-button" disabled={changePasswordMutation.isPending} type="submit">
            {changePasswordMutation.isPending ? "正在保存…" : "确认修改"}
          </button>
        </form>
      </section>
      <ErrorNoticeModal
        message={errorNotice}
        title="修改密码失败"
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen) setErrorNotice("");
        }}
      />
    </div>
  );
}
