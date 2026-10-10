import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

const modalClasses = { backdrop: "start-detection-modal-backdrop", base: "start-detection-modal-content", wrapper: "start-detection-modal-wrapper" };

export function EditorDialog({ title, formId, pending, error, onClose, children, disabled = false }: {
  title: string; formId: string; pending: boolean; error: unknown; onClose: () => void; children: ReactNode; disabled?: boolean;
}) {
  return <Modal classNames={modalClasses} hideCloseButton isOpen isDismissable={!pending} isKeyboardDismissDisabled={pending} placement="center" onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <ModalContent>
      <button aria-label={`关闭${title}弹窗`} className="start-detection-modal-close back-cancel-button" disabled={pending} type="button" onClick={onClose}><X aria-hidden="true" /></button>
      <ModalHeader className="start-detection-modal-header"><span className="start-detection-modal-title-copy">{title}</span></ModalHeader>
      <ModalBody className="start-detection-modal-body">{children}{error ? <p className="project-photo-error" role="alert">{errorMessage(error)}</p> : null}</ModalBody>
      <ModalFooter className="start-detection-modal-footer">
        <button className="back-cancel-button" disabled={pending} type="button" onClick={onClose}>取消</button>
        <button className="button primary-action-button" disabled={pending || disabled} form={formId} type="submit">{pending ? "正在保存…" : "保存"}</button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
}

export function DeleteDialog({ title, pending, error, onClose, onConfirm, children }: {
  title: string; pending: boolean; error: unknown; onClose: () => void; onConfirm: () => void; children: ReactNode;
}) {
  return <Modal classNames={modalClasses} hideCloseButton isOpen isDismissable={!pending} isKeyboardDismissDisabled={pending} placement="center" onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <ModalContent>
      <ModalHeader className="start-detection-modal-header"><span className="start-detection-modal-title-copy">{title}</span></ModalHeader>
      <ModalBody className="start-detection-modal-body">{children}{error ? <p className="project-photo-error" role="alert">{errorMessage(error)}</p> : null}</ModalBody>
      <ModalFooter className="start-detection-modal-footer"><button className="back-cancel-button" disabled={pending} type="button" onClick={onClose}>取消</button><button className="button primary-action-button" disabled={pending} type="button" onClick={onConfirm}>{pending ? "正在删除…" : "确认删除"}</button></ModalFooter>
    </ModalContent>
  </Modal>;
}
