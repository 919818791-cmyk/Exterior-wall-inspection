import { useEffect, useMemo, useState } from "react";

import { updateCurrentUser } from "@/api/auth";
import { AccountEditorModal, type AccountFormState } from "@/components/auth/AccountEditorModal";
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
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const initialForm = useMemo<AccountFormState>(() => ({
    username: user.username,
    password: "",
    real_name: user.real_name ?? "",
    phone: user.phone ?? "",
    organization: user.organization ?? "",
    role: user.role,
    account_plan: user.account_plan,
    status: "active"
  }), [user]);

  useEffect(() => {
    if (!isOpen) return;
    setIsSaving(false);
    setSaveError("");
    setSaveMessage("");
  }, [isOpen]);

  if (!isOpen) return null;

  async function saveProfile(form: AccountFormState) {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const updatedUser = await updateCurrentUser({
        real_name: form.real_name.trim() || null,
        phone: user.phone ?? null,
        organization: form.organization.trim() || null
      });
      updateUser(updatedUser);
      setSaveMessage("个人信息已保存。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "个人信息保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return <AccountEditorModal
    error={saveError}
    initialForm={initialForm}
    isPending={isSaving}
    mode="profile"
    notice={saveMessage}
    onChangePassword={onChangePassword}
    onClose={onClose}
    onSubmit={saveProfile}
  />;
}
