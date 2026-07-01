import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Save, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { accountsQueryOptions, createAccount, resetAccountPassword, updateAccount } from "@/api/accounts";
import type { AccountCreatePayload, AccountUpdatePayload, AccountUser, UserRole, UserStatus } from "@/types/auth";
import { formatDateTime } from "@/utils/projectDisplay";

const roleLabels: Record<UserRole, string> = {
  admin: "管理员",
  reviewer: "内部审核",
  customer: "客户用户"
};

const statusLabels: Record<UserStatus, string> = {
  active: "启用",
  disabled: "停用"
};

const statusClass: Record<UserStatus, "ready" | "neutral"> = {
  active: "ready",
  disabled: "neutral"
};

interface AccountFormState {
  username: string;
  password: string;
  real_name: string;
  phone: string;
  organization: string;
  role: UserRole;
  status: UserStatus;
}

const emptyAccountForm: AccountFormState = {
  username: "",
  password: "",
  real_name: "",
  phone: "",
  organization: "",
  role: "customer",
  status: "active"
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "账号保存失败，请稍后重试。";
}

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formFromAccount(account: AccountUser): AccountFormState {
  return {
    username: account.username,
    password: "",
    real_name: account.real_name ?? "",
    phone: account.phone ?? "",
    organization: account.organization ?? "",
    role: account.role,
    status: account.status
  };
}

export function AccountManagementPage() {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery(accountsQueryOptions);
  const [keyword, setKeyword] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");
  const [status, setStatus] = useState<"all" | UserStatus>("all");
  const [editingAccount, setEditingAccount] = useState<AccountUser | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");

  const createMutation = useMutation({
    mutationFn: createAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      closeEditor();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ accountId, payload }: { accountId: string; payload: AccountUpdatePayload }) => updateAccount(accountId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      closeEditor();
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: resetAccountPassword,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setFormNotice("密码已重置为 123456。");
    }
  });

  const accounts = useMemo(() => {
    const searchText = keyword.trim().toLowerCase();
    return (accountsQuery.data ?? [])
      .filter((account) => role === "all" || account.role === role)
      .filter((account) => status === "all" || account.status === status)
      .filter((account) => {
        if (!searchText) return true;
        return `${account.username} ${account.real_name ?? ""} ${account.organization ?? ""} ${account.phone ?? ""}`
          .toLowerCase()
          .includes(searchText);
      });
  }, [accountsQuery.data, keyword, role, status]);

  const activeMutationError = createMutation.error ?? updateMutation.error ?? resetPasswordMutation.error;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isResettingPassword = resetPasswordMutation.isPending;
  const editorMode = editingAccount ? "edit" : "create";

  function openCreateEditor() {
    setEditingAccount(null);
    setFormError("");
    setFormNotice("");
    resetPasswordMutation.reset();
    setIsEditorOpen(true);
  }

  function openEditEditor(account: AccountUser) {
    setEditingAccount(account);
    setFormError("");
    setFormNotice("");
    resetPasswordMutation.reset();
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditingAccount(null);
    setFormError("");
    setFormNotice("");
    createMutation.reset();
    updateMutation.reset();
    resetPasswordMutation.reset();
  }

  function buildCreatePayload(form: AccountFormState): AccountCreatePayload | null {
    const username = form.username.trim();
    const password = form.password.trim();
    if (!username) {
      setFormError("请输入用户名。");
      return null;
    }
    if (password.length < 8) {
      setFormError("新建账号密码至少 8 位。");
      return null;
    }
    setFormError("");
    return {
      username,
      password,
      real_name: toNullable(form.real_name),
      phone: toNullable(form.phone),
      organization: toNullable(form.organization),
      role: form.role,
      status: form.status
    };
  }

  function buildUpdatePayload(form: AccountFormState): AccountUpdatePayload | null {
    const username = form.username.trim();
    if (!username) {
      setFormError("请输入用户名。");
      return null;
    }
    setFormError("");
    return {
      username,
      real_name: toNullable(form.real_name),
      phone: toNullable(form.phone),
      organization: toNullable(form.organization),
      role: form.role,
      status: form.status
    };
  }

  function submitAccount(form: AccountFormState) {
    if (editorMode === "create") {
      const payload = buildCreatePayload(form);
      if (payload) createMutation.mutate(payload);
      return;
    }
    if (!editingAccount) return;
    const payload = buildUpdatePayload(form);
    if (payload) updateMutation.mutate({ accountId: editingAccount.id, payload });
  }

  function resetPassword() {
    if (!editingAccount) return;
    setFormError("");
    setFormNotice("");
    resetPasswordMutation.reset();
    if (!window.confirm(`确认将账号“${editingAccount.username}”的密码重置为 123456？`)) return;
    resetPasswordMutation.mutate(editingAccount.id);
  }

  const editorInitialForm = useMemo(
    () => (editingAccount ? formFromAccount(editingAccount) : emptyAccountForm),
    [editingAccount]
  );
  const editorError = formError || (activeMutationError ? getErrorMessage(activeMutationError) : "");

  return (
    <div className="account-management-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div>
            <h1>账号管理</h1>
            <p>管理员可统一新建账号，维护用户资料、账号状态与系统权限。</p>
          </div>
          <div className="project-hero-action">
            <button className="button primary new-project-button" type="button" onClick={openCreateEditor}>
              <UserPlus aria-hidden="true" />新建账号
            </button>
          </div>
        </section>

        <section className="project-toolbar account-toolbar" aria-label="账号筛选">
          <label className="select-control">
            <span className="sr-only">按权限筛选</span>
            <select value={role} onChange={(event) => setRole(event.target.value as "all" | UserRole)}>
              <option value="all">全部权限</option>
              <option value="admin">管理员</option>
              <option value="reviewer">内部审核</option>
              <option value="customer">客户用户</option>
            </select>
          </label>
          <label className="select-control">
            <span className="sr-only">按账号状态筛选</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as "all" | UserStatus)}>
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <label className="search-control">
            <span className="sr-only">搜索账号、姓名或单位</span>
            <Search aria-hidden="true" />
            <input placeholder="搜索账号、姓名、单位或手机" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </label>
        </section>

        {accountsQuery.isError ? <p className="project-list-error">账号列表加载失败，请稍后重试。</p> : null}
        <section className="project-list-panel" aria-label="账号列表">
          <div className="project-table-wrap">
            {accountsQuery.isLoading ? (
              <div className="project-empty"><strong>正在加载账号…</strong></div>
            ) : accounts.length ? (
              <table className="project-table account-table">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>权限</th>
                    <th>所属单位</th>
                    <th>手机</th>
                    <th>状态</th>
                    <th>最近登录</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td data-label="账号">
                        <strong>{account.real_name || account.username}</strong>
                        <small>{account.username}</small>
                      </td>
                      <td data-label="权限"><span className="account-role"><ShieldCheck aria-hidden="true" />{roleLabels[account.role]}</span></td>
                      <td data-label="所属单位">{account.organization || "-"}</td>
                      <td data-label="手机"><span className="account-contact">{account.phone || "-"}</span></td>
                      <td data-label="状态"><span className={`status-tag ${statusClass[account.status]}`}>{statusLabels[account.status]}</span></td>
                      <td data-label="最近登录">{formatDateTime(account.last_login_at)}</td>
                      <td data-label="操作">
                        <div className="table-actions">
                          <button className="table-action" type="button" onClick={() => openEditEditor(account)}>
                            <Pencil aria-hidden="true" />编辑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="project-empty"><strong>没有匹配的账号</strong><span>尝试调整权限、状态或搜索关键词</span></div>
            )}
          </div>
          <div className="project-pagination">
            <span>共 <strong>{accounts.length}</strong> 个账号</span>
            <div><button aria-label="上一页" disabled type="button">‹</button><button aria-current="page" className="current-page" type="button">1</button><button aria-label="下一页" disabled type="button">›</button><span className="page-size">10 条/页</span></div>
          </div>
        </section>
      </div>

      {isEditorOpen ? (
        <AccountEditorModal
          error={editorError}
          initialForm={editorInitialForm}
          isResetting={isResettingPassword}
          isPending={isSaving}
          mode={editorMode}
          notice={formNotice}
          onClose={closeEditor}
          onResetPassword={resetPassword}
          onSubmit={submitAccount}
        />
      ) : null}
    </div>
  );
}

interface AccountEditorModalProps {
  error: string;
  initialForm: AccountFormState;
  isResetting: boolean;
  isPending: boolean;
  mode: "create" | "edit";
  notice: string;
  onClose: () => void;
  onResetPassword: () => void;
  onSubmit: (form: AccountFormState) => void;
}

function AccountEditorModal({
  error,
  initialForm,
  isPending,
  isResetting,
  mode,
  notice,
  onClose,
  onResetPassword,
  onSubmit
}: AccountEditorModalProps) {
  const [form, setForm] = useState(initialForm);

  useEffect(() => setForm(initialForm), [initialForm]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending && !isResetting) onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isPending, isResetting, onClose]);

  function updateField<TKey extends keyof AccountFormState>(field: TKey, value: AccountFormState[TKey]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(form);
  }

  function handleClose() {
    if (!isPending && !isResetting) onClose();
  }

  return (
    <div aria-labelledby="account-editor-title" aria-modal="true" className="auth-modal account-editor-modal is-open" role="dialog">
      <button aria-label="关闭账号编辑弹窗" className="auth-modal-backdrop" type="button" onClick={handleClose} />
      <section className="auth-dialog account-editor-dialog">
        <button aria-label="关闭账号编辑弹窗" className="auth-close" disabled={isPending || isResetting} type="button" onClick={handleClose}>
          <X aria-hidden="true" />
        </button>
        <div className="auth-dialog-heading">
          <h2 id="account-editor-title">{mode === "create" ? "新建账号" : "编辑账号"}</h2>
        </div>
        <form className="auth-form account-editor-form" onSubmit={handleSubmit}>
          <div className="account-form-grid">
            <label className="auth-field">
              <span>用户名</span>
              <input
                autoComplete="username"
                placeholder="请输入用户名"
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
                placeholder="请输入姓名"
                value={form.real_name}
                onChange={(event) => updateField("real_name", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>所属单位</span>
              <input
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
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>系统权限</span>
              <select value={form.role} onChange={(event) => updateField("role", event.target.value as UserRole)}>
                <option value="customer">客户用户</option>
                <option value="reviewer">内部审核</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label className="auth-field">
              <span>账号状态</span>
              <select value={form.status} onChange={(event) => updateField("status", event.target.value as UserStatus)}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          </div>
          {notice ? <p className="account-editor-notice" role="status">{notice}</p> : null}
          {error ? <p className="auth-status auth-status-error" role="alert">{error}</p> : null}
          <div className="account-editor-actions">
            {mode === "edit" ? (
              <button className="button secondary account-reset-password-button" disabled={isPending || isResetting} type="button" onClick={onResetPassword}>
                <KeyRound aria-hidden="true" />{isResetting ? "正在重置…" : "重置密码"}
              </button>
            ) : null}
            <div className="account-editor-primary-actions">
              <button className="button secondary" disabled={isPending || isResetting} type="button" onClick={handleClose}>取消</button>
              <button className="button primary" disabled={isPending || isResetting} type="submit">
                <Save aria-hidden="true" />{isPending ? "正在保存…" : "保存账号"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
