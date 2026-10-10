import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { BarChart3, Copy, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  accountsQueryOptions,
  accountUsageDetailQueryOptions,
  createAccount,
  deleteAccount,
  resetAccountPassword,
  resetAccountQuotas,
  updateAccount
} from "@/api/accounts";
import { ApiError } from "@/api/client";
import { WorkbenchNameSearch } from "@/components/WorkbenchNameSearch";
import { AccountEditorModal, type AccountFormState } from "@/components/auth/AccountEditorModal";
import { ErrorNoticeModal } from "@/components/project/PhotoLimitModal";
import { useAuthStore } from "@/stores/useAuthStore";
import type { AccountUsagePeriod, AccountUsageTotals } from "@/types/accountUsage";
import type {
  AccountCreatePayload,
  AccountUpdatePayload,
  AccountUser,
  UserRole,
  UserStatus
} from "@/types/auth";

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

const emptyAccountForm: AccountFormState = {
  username: "",
  password: "",
  real_name: "",
  phone: "",
  organization: "",
  trial_detection_quota: "1000",
  formal_detection_quota: "1000",
  role: "customer",
  status: "active"
};

const integerFormatter = new Intl.NumberFormat("zh-CN");
const accountUsageHistoryStartDate = "2026-07-05";

function hasRecordedUsage(usage: AccountUsageTotals) {
  return usage.task_count > 0 || usage.detected_photo_count > 0 || usage.api_request_count > 0 || usage.token_count > 0;
}

function getErrorMessage(error: unknown, fallback = "账号保存失败，请稍后重试。") {
  if (error instanceof ApiError && typeof error.payload === "object" && error.payload !== null && "detail" in error.payload) {
    return String(error.payload.detail);
  }
  return error instanceof Error ? error.message : fallback;
}

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDetectionQuota(value: string) {
  if (!value.trim()) return null;
  const quota = Number(value);
  return Number.isInteger(quota) && quota >= 1 && quota <= 100_000 ? quota : undefined;
}

function formFromAccount(account: AccountUser): AccountFormState {
  return {
    username: account.username,
    password: "",
    real_name: account.real_name ?? "",
    phone: account.phone ?? "",
    organization: account.organization ?? "",
    trial_detection_quota: account.trial_detection_quota?.toString() ?? "1000",
    formal_detection_quota: account.formal_detection_quota?.toString() ?? "1000",
    role: account.role,
    status: account.status
  };
}

export function AccountManagementPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery(accountsQueryOptions);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [editingAccount, setEditingAccount] = useState<AccountUser | null>(null);
  const [usageAccount, setUsageAccount] = useState<AccountUser | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<AccountUser | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [temporaryPasswordCopied, setTemporaryPasswordCopied] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");

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
      setTemporaryPasswordCopied(false);
      setTemporaryPassword(result.temporary_password);
    }
  });

  const resetQuotaMutation = useMutation({
    mutationFn: resetAccountQuotas,
    onSuccess: async (_, accountId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["account-usage", accountId] }),
        queryClient.invalidateQueries({ queryKey: ["current-account-usage"] })
      ]);
      setFormNotice("账号全部额度已重置。");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async (_, accountId) => {
      queryClient.setQueryData(accountsQueryOptions.queryKey, (current) => current?.filter((account) => account.id !== accountId));
      queryClient.removeQueries({ queryKey: ["account-usage", accountId] });
      setDeletingAccount(null);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    }
  });

  const accounts = accountsQuery.data ?? [];
  const matchingAccounts = useMemo(() => {
    const search = accountSearch.trim().toLocaleLowerCase();
    if (!search) return accounts;
    return accounts.filter((account) => (
      [account.real_name, account.username, account.organization, account.phone]
        .some((value) => value?.toLocaleLowerCase().includes(search))
    ));
  }, [accountSearch, accounts]);

  const activeMutationError = createMutation.error ?? updateMutation.error ?? resetPasswordMutation.error ?? resetQuotaMutation.error;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isResettingPassword = resetPasswordMutation.isPending;
  const isResettingQuota = resetQuotaMutation.isPending;
  const editorMode = editingAccount ? "edit" : "create";

  function openCreateEditor() {
    setEditingAccount(null);
    setFormError("");
    setFormNotice("");
    setTemporaryPassword("");
    setTemporaryPasswordCopied(false);
    resetPasswordMutation.reset();
    resetQuotaMutation.reset();
    setIsEditorOpen(true);
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("create") !== "1") return;
    openCreateEditor();
    navigate("/accounts", { replace: true });
  }, [location.search, navigate]);

  function openEditEditor(account: AccountUser) {
    setEditingAccount(account);
    setFormError("");
    setFormNotice("");
    setTemporaryPassword("");
    setTemporaryPasswordCopied(false);
    resetPasswordMutation.reset();
    resetQuotaMutation.reset();
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditingAccount(null);
    setFormError("");
    setFormNotice("");
    setTemporaryPassword("");
    setTemporaryPasswordCopied(false);
    createMutation.reset();
    updateMutation.reset();
    resetPasswordMutation.reset();
    resetQuotaMutation.reset();
  }

  function buildCreatePayload(form: AccountFormState): AccountCreatePayload | null {
    const username = form.username.trim();
    const password = form.password.trim();
    const trialDetectionQuota = toDetectionQuota(form.trial_detection_quota);
    const formalDetectionQuota = toDetectionQuota(form.formal_detection_quota);
    if (!username) {
      setFormError("请输入用户名。");
      return null;
    }
    if (password.length < 8) {
      setFormError("新建账号密码至少 8 位。");
      return null;
    }
    if (trialDetectionQuota === undefined || formalDetectionQuota === undefined) {
      setFormError("基础版额度和专业版额度需为 1 至 100000 的整数，或留空使用默认额度 1000。");
      return null;
    }
    setFormError("");
    return {
      username,
      password,
      real_name: toNullable(form.real_name),
      phone: toNullable(form.phone),
      organization: toNullable(form.organization),
      trial_detection_quota: trialDetectionQuota,
      formal_detection_quota: formalDetectionQuota,
      role: form.role,
      status: form.status
    };
  }

  function buildUpdatePayload(form: AccountFormState): AccountUpdatePayload | null {
    const username = form.username.trim();
    const trialDetectionQuota = toDetectionQuota(form.trial_detection_quota);
    const formalDetectionQuota = toDetectionQuota(form.formal_detection_quota);
    if (!username) {
      setFormError("请输入用户名。");
      return null;
    }
    if (trialDetectionQuota === undefined || formalDetectionQuota === undefined) {
      setFormError("基础版额度和专业版额度需为 1 至 100000 的整数，或留空使用默认额度 1000。");
      return null;
    }
    setFormError("");
    return {
      username,
      real_name: toNullable(form.real_name),
      phone: toNullable(form.phone),
      organization: toNullable(form.organization),
      trial_detection_quota: trialDetectionQuota,
      formal_detection_quota: formalDetectionQuota,
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

  function resetQuotas() {
    if (!editingAccount) return;
    setFormError("");
    setFormNotice("");
    resetQuotaMutation.reset();
    if (!window.confirm(`确认重置账号“${editingAccount.username}”的全部额度？历史用量记录仍会保留。`)) return;
    resetQuotaMutation.mutate(editingAccount.id);
  }

  async function copyTemporaryPassword() {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setTemporaryPasswordCopied(true);
    } catch {
      setTemporaryPasswordCopied(false);
    }
  }

  const editorInitialForm = useMemo(
    () => (editingAccount ? formFromAccount(editingAccount) : emptyAccountForm),
    [editingAccount]
  );
  const editorError = formError || (activeMutationError ? getErrorMessage(activeMutationError) : "");

  return (
    <div className="account-management-page management-list-page">
      <div className="project-workspace">
        {accountsQuery.isError ? <p className="project-list-error">账号列表加载失败，请稍后重试。</p> : null}
        <section className="project-list-panel workbench-result-list-panel" aria-label="账号列表">
          {accounts.length ? <WorkbenchNameSearch
            label="搜索账号"
            value={accountSearch}
            onChange={setAccountSearch}
          /> : null}
          <div className="project-table-wrap project-workbench-table-wrap">
            {accountsQuery.isLoading ? (
              <div className="project-empty"><strong>正在加载账号…</strong></div>
            ) : accounts.length && matchingAccounts.length ? (
              <table className="project-table account-table">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th className="account-role-column">权限</th>
                    <th className="account-secondary-column">状态</th>
                    <th className="account-actions-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {matchingAccounts.map((account) => (
                    <tr
                      key={account.id}
                      aria-label={`编辑账号 ${account.real_name || account.username}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditEditor(account)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openEditEditor(account);
                      }}
                    >
                      <td data-label="账号">
                        <strong>{account.real_name || account.username}</strong>
                        <small>{account.username}</small>
                      </td>
                      <td className="account-role-column" data-label="权限"><span className="account-role">{roleLabels[account.role]}</span></td>
                      <td className="account-secondary-column" data-label="状态"><span className={`status-tag ${statusClass[account.status]}`}>{statusLabels[account.status]}</span></td>
                      <td className="account-actions-column" data-label="操作">
                        <div className="table-actions">
                          <button
                            aria-label={`查看账号 ${account.real_name || account.username} 的用量`}
                            className="back-cancel-button"
                            title="查看用量"
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setUsageAccount(account); }}
                          ><BarChart3 aria-hidden="true" /></button>
                          <button
                            aria-label={`删除账号 ${account.real_name || account.username}`}
                            className="back-cancel-button"
                            disabled={account.id === currentUserId}
                            title={account.id === currentUserId ? "不能删除当前登录账号" : "删除账号"}
                            type="button"
                            onClick={(event) => { event.stopPropagation(); deleteMutation.reset(); setDeletingAccount(account); }}
                          ><Trash2 aria-hidden="true" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : accounts.length ? (
              <div className="project-empty project-search-empty-state">
                <strong>未找到匹配的账号</strong>
                <span>请尝试其他姓名、用户名、单位或手机号。</span>
              </div>
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
          isResettingQuota={isResettingQuota}
          isPending={isSaving}
          mode={editorMode}
          notice={formNotice}
          onClose={closeEditor}
          onResetPassword={resetPassword}
          onResetQuotas={resetQuotas}
          onSubmit={submitAccount}
        />
      ) : null}
      {usageAccount ? <AccountUsageModal account={usageAccount} onClose={() => setUsageAccount(null)} /> : null}
      <Modal
        classNames={{ backdrop: "start-detection-modal-backdrop", base: "start-detection-modal-content", wrapper: "start-detection-modal-wrapper" }}
        hideCloseButton
        isOpen={deletingAccount !== null}
        isDismissable={!deleteMutation.isPending}
        isKeyboardDismissDisabled={deleteMutation.isPending}
        placement="center"
        onOpenChange={(isOpen) => { if (!isOpen && !deleteMutation.isPending) setDeletingAccount(null); }}
      >
        <ModalContent>
          <ModalHeader className="start-detection-modal-header"><span className="start-detection-modal-title-copy">删除账号</span></ModalHeader>
          <ModalBody className="start-detection-modal-body">
            <p>确认删除账号“{deletingAccount?.real_name || deletingAccount?.username}”？删除后该账号将无法登录，已有项目和历史用量将保留。</p>
            {deleteMutation.isError ? <p className="project-photo-error" role="alert">{getErrorMessage(deleteMutation.error, "账号删除失败，请稍后重试。")}</p> : null}
          </ModalBody>
          <ModalFooter className="start-detection-modal-footer">
            <button className="back-cancel-button" disabled={deleteMutation.isPending} type="button" onClick={() => setDeletingAccount(null)}>取消</button>
            <button className="button primary-action-button" disabled={deleteMutation.isPending} type="button" onClick={() => { if (deletingAccount && !deleteMutation.isPending) deleteMutation.mutate(deletingAccount.id); }}>
              <Trash2 aria-hidden="true" />{deleteMutation.isPending ? "正在删除…" : "确认删除"}
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ErrorNoticeModal
        actionIcon={<Copy aria-hidden="true" />}
        actionLabel={temporaryPasswordCopied ? "已复制" : "复制密码"}
        closeLabel="关闭密码重置结果"
        message={temporaryPassword ? `临时密码：${temporaryPassword}。请立即安全转交用户。` : ""}
        title="密码已重置"
        onAction={() => void copyTemporaryPassword()}
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen) {
            setTemporaryPassword("");
            setTemporaryPasswordCopied(false);
          }
        }}
      />
    </div>
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
        <button aria-label="关闭账号用量弹窗" className="auth-close back-cancel-button" type="button" onClick={onClose}><X aria-hidden="true" /></button>
        <div className="account-usage-heading">
          <div>
            <h2 id="account-usage-title">账号用量</h2>
          </div>
        </div>

        {usageQuery.isError ? (
          <div className="account-usage-feedback error" role="alert">
            <strong>用量统计加载失败</strong>
            <button type="button" onClick={() => void usageQuery.refetch()}><RefreshCw aria-hidden="true" />重试</button>
          </div>
        ) : usageQuery.isLoading || !usage ? (
          <div className="account-usage-feedback"><span className="account-usage-loading-ring" /><strong>正在汇总账号用量…</strong></div>
        ) : (
          <div className="account-usage-content">
            <section className="account-usage-lifetime" aria-label="账号历史累计用量">
              <div><span>历史累计任务</span><strong>{integerFormatter.format(usage.all_time.task_count)}<small>次</small></strong></div>
              <div><span>历史累计已检测照片</span><strong>{integerFormatter.format(usage.all_time.detected_photo_count)}<small>张</small></strong></div>
              <div><span>历史 API 请求</span><strong>{integerFormatter.format(usage.all_time.api_request_count)}<small>次</small></strong></div>
              <div><span>历史输入 Token</span><strong>{integerFormatter.format(usage.all_time.input_token_count)}<small>Token</small></strong></div>
              <div><span>历史输出 Token</span><strong>{integerFormatter.format(usage.all_time.output_token_count)}<small>Token</small></strong></div>
            </section>

            <div className="account-usage-current-heading">
              <div><strong>{period === "week" ? "本周用量" : "本月用量"}</strong><span>{usage.current.start_date} 至 {usage.current.end_date}</span></div>
              <div className="account-usage-period-switch" aria-label="账号用量统计周期">
                <button className={period === "week" ? "active" : ""} type="button" onClick={() => setPeriod("week")}>按周</button>
                <button className={period === "month" ? "active" : ""} type="button" onClick={() => setPeriod("month")}>按月</button>
              </div>
            </div>
            <section className="account-usage-metrics" aria-label="账号本期用量">
              <UsageMetric label="任务数" value={usage.current.task_count} />
              <UsageMetric label="已检测照片" value={usage.current.detected_photo_count} />
              <UsageMetric label="模型 API 请求" value={usage.current.api_request_count} />
              <UsageMetric label="输入 Token" value={usage.current.input_token_count} />
              <UsageMetric label="输出 Token" value={usage.current.output_token_count} />
            </section>

            <section className="account-usage-history">
              <div className="account-usage-history-wrap">
                <table>
                  <thead><tr><th>周期</th><th>任务数</th><th>已检测照片</th><th>API 请求</th><th>输入 Token</th><th>输出 Token</th></tr></thead>
                  <tbody>
                    {[...visibleHistory].reverse().map((item) => (
                      <tr className={item.start_date === usage.current.start_date ? "current" : ""} key={item.start_date}>
                        <td><strong>{item.label}</strong>{item.start_date === usage.current.start_date ? <small>当前</small> : null}</td>
                        <td><strong>{integerFormatter.format(item.task_count)}</strong><span>专业 {integerFormatter.format(item.formal_task_count)} · 快速 {integerFormatter.format(item.trial_task_count)}</span></td>
                        <td>{integerFormatter.format(item.detected_photo_count)} 张</td>
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

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <div><span>{label}</span><strong>{integerFormatter.format(value)}</strong></div>
    </article>
  );
}
