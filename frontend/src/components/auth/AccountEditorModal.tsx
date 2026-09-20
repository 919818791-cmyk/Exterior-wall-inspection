import { BarChart3, KeyRound, RefreshCcw, Save, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import type { AccountPlan, UserRole, UserStatus } from "@/types/auth";

export interface AccountFormState {
  username: string;
  password: string;
  real_name: string;
  phone: string;
  organization: string;
  role: UserRole;
  account_plan: AccountPlan;
  status: UserStatus;
}

interface AccountEditorModalProps {
  error: string;
  initialForm: AccountFormState;
  isResetting?: boolean;
  isResettingQuota?: boolean;
  isPending: boolean;
  mode: "create" | "edit" | "profile";
  notice: string;
  onChangePassword?: () => void;
  onClose: () => void;
  onOpenUsage?: () => void;
  onResetPassword?: () => void;
  onResetQuotas?: () => void;
  onSubmit: (form: AccountFormState) => void;
}

export function AccountEditorModal({
  error,
  initialForm,
  isPending,
  isResetting = false,
  isResettingQuota = false,
  mode,
  notice,
  onChangePassword,
  onClose,
  onOpenUsage,
  onResetPassword,
  onResetQuotas,
  onSubmit
}: AccountEditorModalProps) {
  const [form, setForm] = useState(initialForm);
  const isProfile = mode === "profile";
  const title = mode === "create" ? "新建账号" : isProfile ? "个人信息" : "编辑账号";
  const titleId = isProfile ? "personal-info-title" : "account-editor-title";
  const closeLabel = isProfile ? "关闭个人信息弹窗" : "关闭账号编辑弹窗";

  useEffect(() => setForm(initialForm), [initialForm]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending && !isResetting && !isResettingQuota) onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isPending, isResetting, isResettingQuota, onClose]);

  function updateField<TKey extends keyof AccountFormState>(field: TKey, value: AccountFormState[TKey]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(form);
  }

  function handleClose() {
    if (!isPending && !isResetting && !isResettingQuota) onClose();
  }

  return (
    <div aria-labelledby={titleId} aria-modal="true" className={`auth-modal account-editor-modal${isProfile ? " personal-info-modal" : ""} is-open`} role="dialog">
      <button aria-label={closeLabel} className="auth-modal-backdrop" type="button" onClick={handleClose} />
      <section className="auth-dialog account-editor-dialog">
        <button aria-label={closeLabel} className="auth-close back-cancel-button" disabled={isPending || isResetting || isResettingQuota} type="button" onClick={handleClose}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <h2 id={titleId}>{title}</h2>
        </div>
        <form className="auth-form account-editor-form" onSubmit={handleSubmit}>
          <div className="account-form-grid">
            <label className="auth-field">
              <span>用户名</span>
              <input
                autoComplete="username"
                placeholder="请输入用户名"
                readOnly={isProfile}
                required
                value={form.username}
                onChange={(event) => updateField("username", event.target.value)}
              />
            </label>
            {mode === "create" ? (
              <label className="auth-field">
                <span>初始密码</span>
                <input
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="至少 8 位"
                  required
                  type="password"
                  value={form.password}
                  onChange={(event) => updateField("password", event.target.value)}
                />
              </label>
            ) : null}
            <label className="auth-field">
              <span>姓名</span>
              <input
                autoComplete="name"
                maxLength={64}
                placeholder="请输入姓名"
                value={form.real_name}
                onChange={(event) => updateField("real_name", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>所属单位</span>
              <input
                maxLength={128}
                placeholder="请输入单位名称"
                value={form.organization}
                onChange={(event) => updateField("organization", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>手机</span>
              <input
                autoComplete="tel"
                placeholder="请输入手机号"
                readOnly={isProfile}
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </label>
            {!isProfile ? (
              <label className="auth-field">
                <span>系统权限</span>
                <select value={form.role} onChange={(event) => updateField("role", event.target.value as UserRole)}>
                  <option value="customer">客户用户</option>
                  <option value="reviewer">内部审核</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
            ) : null}
            {!isProfile ? (
              <label className="auth-field">
                <span>账号状态</span>
                <select value={form.status} onChange={(event) => updateField("status", event.target.value as UserStatus)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
            ) : null}
            <label className="auth-field">
              <span>套餐</span>
              <select
                disabled={isProfile || form.role !== "customer"}
                value={form.account_plan}
                onChange={(event) => updateField("account_plan", event.target.value as AccountPlan)}
              >
                <option value="basic">基础版</option>
                <option value="professional">专业版</option>
              </select>
            </label>
          </div>
          {notice ? <p className="account-editor-notice" role="status">{notice}</p> : null}
          {error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
          <div className={`account-editor-actions${isProfile ? " is-profile" : ""}`}>
            {mode === "edit" ? (
              <div className="account-editor-primary-actions">
                <button className="button primary-action-button" disabled={isPending || isResetting || isResettingQuota} type="button" onClick={onResetPassword}>
                  <KeyRound aria-hidden="true" />{isResetting ? "正在重置…" : "重置密码"}
                </button>
                <button className="button primary-action-button" disabled={isPending || isResetting || isResettingQuota} type="button" onClick={onResetQuotas}>
                  <RefreshCcw aria-hidden="true" />{isResettingQuota ? "正在重置…" : "重置额度"}
                </button>
              </div>
            ) : null}
            <div className={`account-editor-primary-actions${mode === "edit" ? " is-editing" : ""}`}>
              {mode === "edit" && onOpenUsage ? (
                <button className="button primary-action-button" disabled={isPending || isResetting || isResettingQuota} type="button" onClick={onOpenUsage}>
                  <BarChart3 aria-hidden="true" />用量
                </button>
              ) : null}
              {isProfile && onChangePassword ? (
                <button className="button primary-action-button" disabled={isPending} type="button" onClick={onChangePassword}>
                  <KeyRound aria-hidden="true" />修改密码
                </button>
              ) : null}
              <button className="button primary-action-button" disabled={isPending || isResetting || isResettingQuota} type="submit">
                <Save aria-hidden="true" />{isPending ? "正在保存…" : mode === "create" ? "保存账号" : "保存修改"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
