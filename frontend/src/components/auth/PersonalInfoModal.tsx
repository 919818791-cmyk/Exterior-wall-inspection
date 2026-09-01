import {
  Building2,
  KeyRound,
  Pencil,
  Phone,
  Save,
  UserRound,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { updateCurrentUser } from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";
import type { AuthUser } from "@/types/auth";

interface PersonalInfoModalProps {
  isOpen: boolean;
  onChangePassword: () => void;
  onClose: () => void;
  user: AuthUser;
}

export function PersonalInfoModal({
  isOpen,
  onChangePassword,
  onClose,
  user
}: PersonalInfoModalProps) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setIsEditing(false);
    setIsSaving(false);
    setRealName(user.real_name ?? "");
    setPhone(user.phone ?? "");
    setOrganization(user.organization ?? "");
    setSaveError("");
    setSaveMessage("");
  }, [isOpen, user.organization, user.phone, user.real_name]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.body.classList.add("auth-modal-open");
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.classList.remove("auth-modal-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    isEditing,
    isOpen,
    isSaving,
    organization,
    phone,
    realName,
    user.organization,
    user.phone,
    user.real_name
  ]);

  if (!isOpen) return null;

  const hasUnsavedChanges = isEditing && (
    realName.trim() !== (user.real_name ?? "").trim()
    || phone.trim() !== (user.phone ?? "").trim()
    || organization.trim() !== (user.organization ?? "").trim()
  );

  function requestClose() {
    if (isSaving) return;
    if (hasUnsavedChanges && !window.confirm("个人信息尚未保存，确认放弃修改？")) return;
    onClose();
  }

  function cancelEditing() {
    if (hasUnsavedChanges && !window.confirm("确认放弃未保存的个人信息修改？")) return;
    setIsEditing(false);
    setRealName(user.real_name ?? "");
    setPhone(user.phone ?? "");
    setOrganization(user.organization ?? "");
    setSaveError("");
    setSaveMessage("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEditing || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const updatedUser = await updateCurrentUser({
        real_name: realName.trim() || null,
        phone: phone.trim() || null,
        organization: organization.trim() || null
      });
      updateUser(updatedUser);
      setRealName(updatedUser.real_name ?? "");
      setPhone(updatedUser.phone ?? "");
      setOrganization(updatedUser.organization ?? "");
      setIsEditing(false);
      setSaveMessage("个人信息已保存。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "个人信息保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div aria-labelledby="personal-info-title" aria-modal="true" className="auth-modal personal-info-modal is-open" role="dialog">
      <button aria-label="关闭个人信息弹窗" className="auth-modal-backdrop" type="button" onClick={requestClose} />
      <section className="auth-dialog personal-info-dialog">
        <button aria-label="关闭个人信息弹窗" className="auth-close" disabled={isSaving} type="button" onClick={requestClose}>
          <X aria-hidden="true" />
        </button>

        <div className="personal-info-heading">
          <span aria-hidden="true" className="personal-info-avatar"><UserRound /></span>
          <div>
            <h2 id="personal-info-title">个人信息</h2>
          </div>
        </div>

        <form onSubmit={saveProfile}>
          <dl className="personal-info-list">
            <div>
              <dt><UserRound aria-hidden="true" />用户名</dt>
              <dd>{user.username}</dd>
            </div>
            <div>
              <dt><UserRound aria-hidden="true" />姓名</dt>
              <dd>
                {isEditing ? (
                  <input
                    aria-label="姓名"
                    autoFocus
                    maxLength={64}
                    placeholder="请输入姓名"
                    value={realName}
                    onChange={(event) => setRealName(event.target.value)}
                  />
                ) : user.real_name?.trim() || "未填写"}
              </dd>
            </div>
            <div>
              <dt><Phone aria-hidden="true" />手机号码</dt>
              <dd>
                {isEditing ? (
                  <input
                    aria-label="手机号码"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="请输入11位手机号码"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                  />
                ) : user.phone?.trim() || "未填写"}
              </dd>
            </div>
            <div>
              <dt><Building2 aria-hidden="true" />所属单位</dt>
              <dd>
                {isEditing ? (
                  <input
                    aria-label="所属单位"
                    maxLength={128}
                    placeholder="请输入所属单位"
                    value={organization}
                    onChange={(event) => setOrganization(event.target.value)}
                  />
                ) : user.organization?.trim() || "未填写"}
              </dd>
            </div>
          </dl>

          {saveError ? <p className="personal-info-error" role="alert">{saveError}</p> : null}
          {saveMessage ? <p className="personal-info-success" role="status">{saveMessage}</p> : null}

          <div className="personal-info-actions">
            {isEditing ? (
              <>
                <button className="personal-info-action back-cancel-button" disabled={isSaving} type="button" onClick={cancelEditing}>取消</button>
                <button className="personal-info-action primary primary-action-button" disabled={isSaving} type="submit">
                  <Save aria-hidden="true" />{isSaving ? "保存中…" : "保存"}
                </button>
              </>
            ) : (
              <>
                <button className="personal-info-action personal-info-action-pill secondary" type="button" onClick={() => setIsEditing(true)}>
                  <Pencil aria-hidden="true" />编辑资料
                </button>
                <button className="personal-info-action personal-info-action-pill primary" type="button" onClick={onChangePassword}>
                  <KeyRound aria-hidden="true" />修改密码
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
