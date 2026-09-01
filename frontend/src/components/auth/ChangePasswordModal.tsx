import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { changePassword } from "@/api/auth";
import { ApiError } from "@/api/client";
import { PasswordInput } from "@/components/auth/PasswordInput";

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && typeof error.payload === "object" && error.payload !== null && "detail" in error.payload) {
    return String((error.payload as { detail: unknown }).detail);
  }
  return error instanceof Error ? error.message : "修改密码失败，请稍后重试。";
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
  const [validationError, setValidationError] = useState("");
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      onClose();
      onPasswordChanged();
    }
  });

  useEffect(() => {
    if (isOpen) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setValidationError("");
    changePasswordMutation.reset();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    document.body.classList.add("auth-modal-open");
    const focusFrame = window.requestAnimationFrame(() => currentPasswordRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove("auth-modal-open");
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [changePasswordMutation.isPending, confirmPassword, currentPassword, isOpen, newPassword, onClose]);

  function closeModal() {
    if (changePasswordMutation.isPending) return;
    const hasInput = Boolean(currentPassword || newPassword || confirmPassword);
    if (hasInput && !window.confirm("密码修改尚未提交，确认放弃？")) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentPassword === newPassword) {
      setValidationError("新密码不能与当前密码相同。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("两次输入的新密码不一致。");
      return;
    }
    setValidationError("");
    changePasswordMutation.mutate();
  }

  if (!isOpen) return null;

  const error = validationError || (changePasswordMutation.isError ? getErrorMessage(changePasswordMutation.error) : "");

  return (
    <div aria-labelledby="change-password-title" aria-modal="true" className="auth-modal change-password-modal is-open" role="dialog">
      <button aria-label="关闭修改密码弹窗" className="auth-modal-backdrop" type="button" onClick={closeModal} />
      <section className="auth-dialog">
        <button aria-label="关闭修改密码弹窗" className="auth-close" disabled={changePasswordMutation.isPending} type="button" onClick={closeModal}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <h2 id="change-password-title">修改密码</h2>
        </div>
        <p className="auth-status auth-status-info" role="note">密码修改成功后，当前登录会失效，需要使用新密码重新登录。</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <PasswordInput
            ref={currentPasswordRef}
            autoComplete="current-password"
            label="当前密码"
            maxLength={128}
            placeholder="请输入当前密码"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <PasswordInput
            autoComplete="new-password"
            label="新密码"
            maxLength={128}
            minLength={8}
            placeholder="至少 8 位"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <PasswordInput
            autoComplete="new-password"
            label="确认新密码"
            maxLength={128}
            minLength={8}
            placeholder="再次输入新密码"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
          <button className="auth-submit" disabled={changePasswordMutation.isPending} type="submit">
            {changePasswordMutation.isPending ? "正在保存…" : "确认修改"}
          </button>
        </form>
      </section>
    </div>
  );
}
