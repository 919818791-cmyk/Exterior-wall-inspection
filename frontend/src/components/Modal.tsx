import { Modal as HeroUIModal, type ModalProps } from "@heroui/react";
import { forwardRef } from "react";

export { ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";

// Lazy motion can reset overlay opacity after entry. Keep every app modal on
// the same static rendering path, including transitions between detection stages.
export const Modal = forwardRef<HTMLDivElement, ModalProps>(function Modal(props, ref) {
  return <HeroUIModal {...props} ref={ref} disableAnimation />;
});
