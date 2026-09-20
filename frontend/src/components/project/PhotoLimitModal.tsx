import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function ErrorNoticeModal({
  actionIcon,
  actionLabel,
  closeLabel = "关闭错误提示",
  message,
  messageClassName = "text-sm",
  onAction,
  onOpenChange,
  title = "错误提示"
}: {
  actionIcon?: ReactNode;
  actionLabel?: string;
  closeLabel?: string;
  message: string;
  messageClassName?: string;
  onAction?: () => void;
  onOpenChange: (isOpen: boolean) => void;
  title?: string;
}) {
  return (
    <Modal
      classNames={{
        backdrop: "start-detection-modal-backdrop",
        base: "start-detection-modal-content",
        wrapper: "start-detection-modal-wrapper"
      }}
      hideCloseButton
      isOpen={Boolean(message)}
      placement="center"
      size="sm"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <button
              aria-label={closeLabel}
              className="start-detection-modal-close back-cancel-button"
              type="button"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
            <ModalHeader className="start-detection-modal-header">
              <span className="start-detection-modal-title-copy">{title}</span>
            </ModalHeader>
            <ModalBody className="start-detection-modal-body">
              <p className={`${messageClassName} leading-6 text-slate-600`}>{message}</p>
            </ModalBody>
            <ModalFooter className="start-detection-modal-footer">
              {actionLabel && onAction ? (
                <button className="button primary-action-button" type="button" onClick={onAction}>
                  {actionIcon}{actionLabel}
                </button>
              ) : null}
              <button className="button primary-action-button" type="button" onClick={onClose}>
                我知道了
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
