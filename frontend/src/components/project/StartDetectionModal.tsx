import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { StartDetectionPayload } from "@/types/projects";

type DetectionModelType = StartDetectionPayload["model_types"][number];

const DETECTION_TYPE_OPTIONS: Array<{
  value: DetectionModelType;
  label: string;
}> = [
  { value: "crack", label: "裂缝" },
  { value: "spalling", label: "剥落" },
  { value: "hollow", label: "空鼓" }
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function StartDetectionModal({
  error,
  isProfessional = false,
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
  isProfessional?: boolean;
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
  const [generateBuildingModel, setGenerateBuildingModel] = useState(false);
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
    setGenerateBuildingModel(false);
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
    onSubmit({
      generate_building_model: isProfessional && generateBuildingModel,
      model_types: modelTypes
    });
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
              <span className="start-detection-modal-title-copy">
                开始检测
              </span>
            </ModalHeader>
            <ModalBody className="start-detection-modal-body gap-5">
              {nonDronePhotoCount || rejectedPhotoCount - nonDronePhotoCount > 0 ? (
                <div className="start-detection-cleanup-notice">
                  {nonDronePhotoCount ? (
                    <span>{nonDronePhotoCount} 张非无人机照片将在确认后自动从照片列表中移除</span>
                  ) : null}
                  {rejectedPhotoCount - nonDronePhotoCount > 0 ? (
                    <span>{rejectedPhotoCount - nonDronePhotoCount} 张非建筑照片将在确认后自动从照片列表中移除</span>
                  ) : null}
                </div>
              ) : null}

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
                          disabled={
                            isPending
                            || (option.value === "hollow" && thermalPhotoCount === 0)
                          }
                          type="checkbox"
                          onChange={() => toggleModel(option.value)}
                        />
                        <strong>
                          {option.label}{option.value === "hollow" ? "（Beta）" : ""}
                        </strong>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {isProfessional ? (
                <fieldset className="start-detection-addons">
                  <legend>附加能力</legend>
                  <label className="start-detection-addon-option">
                    <strong className="start-detection-addon-copy">生成三维模型</strong>
                    <input
                      checked={generateBuildingModel}
                      className="sr-only"
                      disabled={isPending}
                      type="checkbox"
                      onChange={(event) => setGenerateBuildingModel(event.target.checked)}
                    />
                    <span aria-hidden="true" className="start-detection-addon-switch">
                      <span />
                    </span>
                  </label>
                  <p className={`start-detection-addon-hint${generateBuildingModel ? " is-enabled" : ""}`}>
                    {generateBuildingModel
                      ? "为了获得最佳结果，请确保您采集的照片具有良好的GPS、重叠、光照和距离"
                      : "基于无人机照片生成建筑三维模型"}
                  </p>
                </fieldset>
              ) : null}

              {localError || error ? (
                <p className="start-detection-error" role="alert">
                  {localError || getErrorMessage(error)}
                </p>
              ) : null}
            </ModalBody>
            <ModalFooter className="start-detection-modal-footer">
              <button
                className="back-cancel-button"
                disabled={isPending}
                type="button"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="button primary-action-button"
                disabled={isPending}
                type="button"
                onClick={submit}
              >
                确认并开始检测
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
