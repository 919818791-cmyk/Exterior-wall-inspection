import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addCurrentAccountQuota, currentAccountUsageQueryOptions } from "@/api/accounts";
import { ApiError } from "@/api/client";

export function AddQuotaModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<200 | 500 | 1000>(200);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: addCurrentAccountQuota,
    onSuccess: (usage) => {
      queryClient.setQueryData(currentAccountUsageQueryOptions.queryKey, usage);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["account-usage", usage.account_id] });
      onClose();
    }
  });
  const error = mutation.error instanceof ApiError ? mutation.error.message : "添加额度失败，请重试。";

  return (
    <Modal
      classNames={{ backdrop: "start-detection-modal-backdrop", base: "start-detection-modal-content", wrapper: "start-detection-modal-wrapper" }}
      hideCloseButton
      isDismissable={!mutation.isPending}
      isKeyboardDismissDisabled={mutation.isPending}
      isOpen
      placement="center"
      onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}
    >
      <ModalContent>
        <button aria-label="关闭添加额度弹窗" className="start-detection-modal-close back-cancel-button" disabled={mutation.isPending} type="button" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <ModalHeader className="start-detection-modal-header">
          <span className="start-detection-modal-title-copy">添加额度</span>
        </ModalHeader>
        <ModalBody className="start-detection-modal-body">
          <p>专业检测和快速体验各增加所选额度。</p>
          <fieldset className="start-detection-types" disabled={mutation.isPending}>
            <legend>添加数量</legend>
            <div className="start-detection-option-grid">
              {([200, 500, 1000] as const).map((value) => (
                <label className={`start-detection-option${amount === value ? " is-selected" : ""}`} key={value}>
                  <span className="start-detection-option-heading">
                    <input checked={amount === value} disabled={mutation.isPending} name="add-quota-amount" type="radio" value={value} onChange={() => { setAmount(value); mutation.reset(); }} />
                    <strong>{value} 张</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {mutation.isError ? <p className="project-photo-error" role="alert">{error}</p> : null}
        </ModalBody>
        <ModalFooter className="start-detection-modal-footer">
          <button className="back-cancel-button" disabled={mutation.isPending} type="button" onClick={onClose}>取消</button>
          <button className="button primary-action-button" disabled={mutation.isPending} type="button" onClick={() => { if (!mutation.isPending) mutation.mutate(amount); }}>
            {mutation.isPending ? "正在添加…" : "确定"}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
