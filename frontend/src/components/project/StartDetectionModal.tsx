import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import { Images, ScanLine, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { StartDetectionPayload } from "@/types/projects";

type DetectionModelType = StartDetectionPayload["model_types"][number];

const DETECTION_TYPE_OPTIONS: Array<{
  value: DetectionModelType;
  label: string;
  description: string;
}> = [
  { value: "crack", label: "裂缝", description: "分析可见光照片中的线状开裂" },
  { value: "spalling", label: "剥落", description: "分析可见光照片中的面状材料缺失" },
  { value: "hollow", label: "空鼓", description: "仅分析热成像照片中的疑似空鼓" }
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function StartDetectionModal({
  error,
  isOpen,
  isPending,
  nonDronePhotoCount = 0,
  qualifiedPhotoCount,
  rejectedPhotoCount = 0,
  thermalPhotoCount,
  onOpenChange,
  onSubmit
}: {
  error?: unknown;
  isOpen: boolean;
  isPending: boolean;
  nonDronePhotoCount?: number;
  qualifiedPhotoCount: number;
  rejectedPhotoCount?: number;
  thermalPhotoCount: number;
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (payload: StartDetectionPayload) => void;
}) {
  const [modelTypes, setModelTypes] = useState<DetectionModelType[]>(["crack"]);
  const [localError, setLocalError] = useState("");
  const visiblePhotoCount = qualifiedPhotoCount - thermalPhotoCount;

  useEffect(() => {
    if (!isOpen) return;
    setModelTypes(
      thermalPhotoCount > 0
        ? visiblePhotoCount > 0
          ? ["crack", "hollow"]
          : ["hollow"]
        : ["crack"]
    );
    setLocalError("");
  }, [isOpen, thermalPhotoCount, visiblePhotoCount]);

  const toggleModel = (model: DetectionModelType) => {
    setModelTypes((current) => current.includes(model)
      ? current.filter((value) => value !== model)
      : [...current, model]);
    setLocalError("");
  };

  const submit = () => {
    if (!qualifiedPhotoCount) {
      setLocalError("当前没有预检通过的照片，请先上传合格照片并等待预检完成。");
      return;
    }
    if (!modelTypes.length) {
      setLocalError("请至少勾选一种检测类型。");
      return;
    }
    if (thermalPhotoCount && !modelTypes.includes("hollow")) {
      setLocalError("热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。");
      return;
    }
    if (
      visiblePhotoCount
      && !modelTypes.some((model) => model === "crack" || model === "spalling")
    ) {
      setLocalError("可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。");
      return;
    }
    onOpenChange(false);
    onSubmit({ model_types: modelTypes });
  };

  return (
    <Modal
      classNames={{
        backdrop: "start-detection-modal-backdrop",
        base: "start-detection-modal-content",
        wrapper: "start-detection-modal-wrapper"
      }}
      hideCloseButton
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <button
              aria-label="关闭开始检测弹窗"
              className="start-detection-modal-close"
              disabled={isPending}
              type="button"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
            <ModalHeader className="start-detection-modal-header">
              <span className="start-detection-modal-title-icon" aria-hidden="true">
                <ScanLine />
              </span>
              <span className="start-detection-modal-title-copy">开始 AI 检测</span>
            </ModalHeader>
            <ModalBody className="start-detection-modal-body gap-5">
              <div className="start-detection-summary">
                <span className="start-detection-summary-icon" aria-hidden="true">
                  <Images />
                </span>
                <span className="start-detection-summary-copy">
                  <strong>{qualifiedPhotoCount} 张照片将参与检测</strong>
                  {nonDronePhotoCount ? (
                    <span>{nonDronePhotoCount} 张非无人机照片将在确认后自动从照片列表中移除</span>
                  ) : null}
                  {rejectedPhotoCount - nonDronePhotoCount > 0 ? (
                    <span>{rejectedPhotoCount - nonDronePhotoCount} 张非建筑照片将在确认后自动从照片列表中移除</span>
                  ) : null}
                </span>
                <span className="start-detection-ready-badge">已就绪</span>
              </div>

              <fieldset className="start-detection-types">
                <legend>检测类型</legend>
                <div className="start-detection-option-grid">
                  {DETECTION_TYPE_OPTIONS.map((option) => (
                    <label
                      className={`start-detection-option ${
                        modelTypes.includes(option.value) ? "is-selected" : ""
                      }`}
                      key={option.value}
                    >
                      <span className="start-detection-option-heading">
                        <input
                          checked={modelTypes.includes(option.value)}
                          disabled={isPending}
                          type="checkbox"
                          onChange={() => toggleModel(option.value)}
                        />
                        <strong>
                          {option.label}{option.value === "hollow" ? "（Beta）" : ""}
                        </strong>
                      </span>
                      <small>{option.description}</small>
                    </label>
                  ))}
                </div>
              </fieldset>

              {localError || error ? (
                <p className="start-detection-error" role="alert">
                  {localError || getErrorMessage(error)}
                </p>
              ) : null}
            </ModalBody>
            <ModalFooter className="start-detection-modal-footer">
              <button
                className="button secondary report-back-button start-detection-cancel-button"
                disabled={isPending}
                type="button"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={isPending}
                type="button"
                onClick={submit}
              >
                {isPending ? "正在检测，请稍候…" : "确认并开始检测"}
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
