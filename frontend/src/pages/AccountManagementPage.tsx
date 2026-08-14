import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, BarChart3, Bot, Database, KeyRound, Pencil, RefreshCw, Save, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import {
  accountsQueryOptions,
  accountUsageDetailQueryOptions,
  accountUsageSummaryQueryOptions,
  createAccount,
  resetAccountPassword,
  updateAccount
} from "@/api/accounts";
import type { AccountUsagePeriod, AccountUsageTotals } from "@/types/accountUsage";
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

const integerFormatter = new Intl.NumberFormat("zh-CN");
const accountUsageHistoryStartDate = "2026-07-05";

function hasRecordedUsage(usage: AccountUsageTotals) {
  return usage.task_count > 0 || usage.api_request_count > 0 || usage.token_count > 0;
}

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
  const usageSummaryQuery = useQuery(accountUsageSummaryQueryOptions);
  const [editingAccount, setEditingAccount] = useState<AccountUser | null>(null);
  const [usageAccount, setUsageAccount] = useState<AccountUser | null>(null);
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
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setFormNotice(`密码已重置。临时密码：${result.temporary_password}（请立即安全转交用户）`);
    }
  });

  const accounts = accountsQuery.data ?? [];
  const usageByAccount = useMemo(
    () => new Map((usageSummaryQuery.data ?? []).map((item) => [item.account_id, item])),
    [usageSummaryQuery.data]
  );

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
    if (!window.confirm(`确认重置账号“${editingAccount.username}”的密码？系统将生成一个随机临时密码。`)) return;
    resetPasswordMutation.mutate(editingAccount.id);
  }

  const editorInitialForm = useMemo(
    () => (editingAccount ? formFromAccount(editingAccount) : emptyAccountForm),
    [editingAccount]
  );
  const editorError = formError || (activeMutationError ? getErrorMessage(activeMutationError) : "");

  return (
    <div className="account-management-page management-list-page">
      <div className="project-workspace">
        <section className="project-hero">
          <div className="management-page-title">
            <UsersRound aria-hidden="true" className="management-page-title-icon" />
            <h1>账号管理</h1>
          </div>
          <div className="project-hero-action standalone-management-actions">
            <RouterLink className="button secondary report-back-button standalone-management-home-link" to="/">
              <ArrowLeft aria-hidden="true" />
              <span>返回首页</span>
            </RouterLink>
            <button className="button primary report-back-button" type="button" onClick={openCreateEditor}>
              <UserPlus aria-hidden="true" />新建账号
            </button>
          </div>
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
                    <th className="account-role-column">权限</th>
                    <th className="account-secondary-column">状态</th>
                    <th className="account-secondary-column">最近登录</th>
                    <th className="account-usage-column">累计任务数</th>
                    <th className="account-usage-column">累计模型 API 请求</th>
                    <th className="account-usage-column">累计 Token 消耗</th>
                    <th className="account-action-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td data-label="账号">
                        <strong>{account.real_name || account.username}</strong>
                        <small>{account.username}</small>
                      </td>
                      <td className="account-role-column" data-label="权限"><span className="account-role"><ShieldCheck aria-hidden="true" />{roleLabels[account.role]}</span></td>
                      <td className="account-secondary-column" data-label="状态"><span className={`status-tag ${statusClass[account.status]}`}>{statusLabels[account.status]}</span></td>
                      <td className="account-secondary-column" data-label="最近登录">{formatDateTime(account.last_login_at)}</td>
                      <td className="account-usage-column" data-label="累计任务数">
                        <AccountUsageValue
                          isError={usageSummaryQuery.isError}
                          isLoading={usageSummaryQuery.isLoading}
                          suffix="次"
                          value={usageByAccount.get(account.id)?.task_count}
                        />
                      </td>
                      <td className="account-usage-column" data-label="累计模型 API 请求">
                        <AccountUsageValue
                          isError={usageSummaryQuery.isError}
                          isLoading={usageSummaryQuery.isLoading}
                          suffix="次"
                          value={usageByAccount.get(account.id)?.api_request_count}
                        />
                      </td>
                      <td className="account-usage-column" data-label="累计 Token 消耗">
                        <AccountUsageValue
                          isError={usageSummaryQuery.isError}
                          isLoading={usageSummaryQuery.isLoading}
                          suffix="Token"
                          value={usageByAccount.get(account.id)?.token_count}
                        />
                      </td>
                      <td className="account-action-column" data-label="操作">
                        <div className="table-actions">
                          <button className="table-action account-usage-action" type="button" onClick={() => setUsageAccount(account)}>
                            <BarChart3 aria-hidden="true" />用量
                          </button>
                          <button className="table-action table-action-result" type="button" onClick={() => openEditEditor(account)}>
                            <Pencil aria-hidden="true" />编辑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="project-empty"><strong>暂无账号</strong><span>点击“新建账号”创建第一个账号</span></div>
            )}
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
      {usageAccount ? <AccountUsageModal account={usageAccount} onClose={() => setUsageAccount(null)} /> : null}
    </div>
  );
}

function AccountUsageValue({
  isError,
  isLoading,
  suffix,
  value
}: {
  isError: boolean;
  isLoading: boolean;
  suffix: string;
  value?: number;
}) {
  if (isLoading) return <span className="account-usage-state">统计中…</span>;
  if (isError) return <span className="account-usage-state error">暂不可用</span>;
  return (
    <span className="account-usage-value">
      <strong>{integerFormatter.format(value ?? 0)}</strong> {suffix}
    </span>
  );
}

function AccountUsageModal({ account, onClose }: { account: AccountUser; onClose: () => void }) {
  const [period, setPeriod] = useState<AccountUsagePeriod>("week");
  const usageQuery = useQuery(accountUsageDetailQueryOptions(account.id, period));
  const usage = usageQuery.data;
  const visibleHistory = usage?.history.filter(
    (item) => item.end_date >= accountUsageHistoryStartDate || hasRecordedUsage(item)
  ) ?? [];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div aria-labelledby="account-usage-title" aria-modal="true" className="auth-modal account-usage-modal is-open" role="dialog">
      <button aria-label="关闭账号用量弹窗" className="auth-modal-backdrop" type="button" onClick={onClose} />
      <section className="auth-dialog account-usage-dialog">
        <button aria-label="关闭账号用量弹窗" className="auth-close" type="button" onClick={onClose}><X aria-hidden="true" /></button>
        <div className="account-usage-heading">
          <div>
            <h2 id="account-usage-title">账号用量</h2>
          </div>
          <div className="data-period-switch" aria-label="账号用量统计周期">
            <button className={period === "week" ? "active" : ""} type="button" onClick={() => setPeriod("week")}>按周</button>
            <button className={period === "month" ? "active" : ""} type="button" onClick={() => setPeriod("month")}>按月</button>
          </div>
        </div>

        {usageQuery.isError ? (
          <div className="account-usage-feedback error" role="alert">
            <strong>用量统计加载失败</strong>
            <button type="button" onClick={() => void usageQuery.refetch()}><RefreshCw aria-hidden="true" />重试</button>
          </div>
        ) : usageQuery.isLoading || !usage ? (
          <div className="account-usage-feedback"><span className="data-loading-ring" /><strong>正在汇总账号用量…</strong></div>
        ) : (
          <div className="account-usage-content">
            <section className="account-usage-lifetime" aria-label="账号历史累计用量">
              <div><span>历史累计任务</span><strong>{integerFormatter.format(usage.all_time.task_count)}<small>次</small></strong></div>
              <div><span>历史 API 请求</span><strong>{integerFormatter.format(usage.all_time.api_request_count)}<small>次</small></strong></div>
              <div><span>历史输入 Token</span><strong>{integerFormatter.format(usage.all_time.input_token_count)}<small>Token</small></strong></div>
              <div><span>历史输出 Token</span><strong>{integerFormatter.format(usage.all_time.output_token_count)}<small>Token</small></strong></div>
            </section>

            <div className="account-usage-current-heading">
              <div><strong>{period === "week" ? "本周用量" : "本月用量"}</strong><span>{usage.current.start_date} 至 {usage.current.end_date}</span></div>
              <small>仅统计已完成并成功落账的模型任务</small>
            </div>
            <section className="account-usage-metrics" aria-label="账号本期用量">
              <UsageMetric icon={<Bot aria-hidden="true" />} label="任务数" value={usage.current.task_count} detail={`正式 ${integerFormatter.format(usage.current.formal_task_count)} · Trial ${integerFormatter.format(usage.current.trial_task_count)}`} />
              <UsageMetric icon={<Database aria-hidden="true" />} label="模型 API 请求" value={usage.current.api_request_count} detail="模型推理请求次数" />
              <UsageMetric icon={<ArrowDownToLine aria-hidden="true" />} label="输入 Token" value={usage.current.input_token_count} detail="发送至模型" />
              <UsageMetric icon={<ArrowUpFromLine aria-hidden="true" />} label="输出 Token" value={usage.current.output_token_count} detail="模型生成" />
            </section>

            <section className="account-usage-history">
              <div className="account-usage-history-wrap">
                <table>
                  <thead><tr><th>周期</th><th>任务数</th><th>API 请求</th><th>输入 Token</th><th>输出 Token</th></tr></thead>
                  <tbody>
                    {[...visibleHistory].reverse().map((item) => (
                      <tr className={item.start_date === usage.current.start_date ? "current" : ""} key={item.start_date}>
                        <td><strong>{item.label}</strong>{item.start_date === usage.current.start_date ? <small>当前</small> : null}</td>
                        <td><strong>{integerFormatter.format(item.task_count)}</strong><span>正式 {integerFormatter.format(item.formal_task_count)} · Trial {integerFormatter.format(item.trial_task_count)}</span></td>
                        <td>{integerFormatter.format(item.api_request_count)} 次</td>
                        <td>{integerFormatter.format(item.input_token_count)} Token</td>
                        <td>{integerFormatter.format(item.output_token_count)} Token</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function UsageMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: number; detail: string }) {
  return (
    <article>
      <span className="account-usage-metric-icon">{icon}</span>
      <div><span>{label}</span><strong>{integerFormatter.format(value)}</strong><small>{detail}</small></div>
    </article>
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
