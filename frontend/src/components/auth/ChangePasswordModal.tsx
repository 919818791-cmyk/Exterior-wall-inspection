import { useMutation } from "@tanstack/react-query";
import { KeyRound, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { changePassword } from "@/api/auth";
import { ApiError } from "@/api/client";

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
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !changePasswordMutation.isPending) onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => currentPasswordRef.current?.focus());

    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [changePasswordMutation.isPending, isOpen, onClose]);

  function closeModal() {
    if (!changePasswordMutation.isPending) onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    <div aria-labelledby="change-password-title" aria-modal="true" className="auth-modal change-password-modal" role="dialog">
      <button aria-label="关闭修改密码弹窗" className="auth-modal-backdrop" type="button" onClick={closeModal} />
      <section className="auth-dialog">
        <button aria-label="关闭修改密码弹窗" className="auth-close" disabled={changePasswordMutation.isPending} type="button" onClick={closeModal}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <p className="change-password-eyebrow"><KeyRound aria-hidden="true" />账户安全</p>
          <h2 id="change-password-title">修改密码</h2>
          <p>设置完成后，需使用新密码重新登录。</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>当前密码</span>
            <input
              ref={currentPasswordRef}
              autoComplete="current-password"
              placeholder="请输入当前密码"
              required
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>新密码</span>
            <input
              autoComplete="new-password"
              minLength={8}
              placeholder="至少 8 位"
              required
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>确认新密码</span>
            <input
              autoComplete="new-password"
              minLength={8}
              placeholder="再次输入新密码"
              required
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
          <button className="auth-submit" disabled={changePasswordMutation.isPending} type="submit">
            {changePasswordMutation.isPending ? "正在保存…" : "确认修改"}
          </button>
        </form>
      </section>
    </div>
  );
}
