import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "登录失败，请稍后重试。";
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
}

/** The single sign-in surface for the whole application. It follows the prototype dialog. */
export function AuthModal({ isOpen, onClose, onAuthenticated }: AuthModalProps) {
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const [username, setUsername] = useState("customer");
  const [password, setPassword] = useState("Customer123!");
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const loginMutation = useMutation({
    mutationFn: () => login({ username, password }),
    onSuccess: (result) => {
      setAuthenticated(result.user, result.access_token);
      if (onAuthenticated) onAuthenticated();
      else onClose();
    }
  });

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => usernameInputRef.current?.focus());

    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onClose]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  if (!isOpen) return null;

  return (
    <div aria-labelledby="auth-title" aria-modal="true" className="auth-modal is-open" role="dialog">
      <button aria-label="关闭登录弹窗" className="auth-modal-backdrop" type="button" onClick={onClose} />
      <section className="auth-dialog">
        <button aria-label="关闭登录弹窗" className="auth-close" type="button" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <h2 id="auth-title">账号登录</h2>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
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
          {loginMutation.isError ? <p className="auth-status auth-status-error">{getErrorMessage(loginMutation.error)}</p> : null}
          <button className="auth-submit" disabled={loginMutation.isPending} type="submit">
            {loginMutation.isPending ? "正在登录…" : "登录"}
          </button>
        </form>
      </section>
    </div>
  );
}
