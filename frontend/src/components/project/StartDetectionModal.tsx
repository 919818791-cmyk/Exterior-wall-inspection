import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorNoticeModal } from "@/components/project/PhotoLimitModal";
import type { FacadeType, StartDetectionPayload } from "@/types/projects";

type DetectionModelType = StartDetectionPayload["model_types"][number];

const DETECTION_TYPE_OPTIONS: Array<{
  value: DetectionModelType;
  label: string;
}> = [
  { value: "crack", label: "裂缝" },
  { value: "spalling", label: "脱落" },
  { value: "peeling", label: "起皮" },
  { value: "damage", label: "面板破损" },
  { value: "hollow", label: "空鼓" }
];

function detectionTypesForFacade(facadeType?: FacadeType): DetectionModelType[] {
  if (facadeType === "tile") return ["crack", "spalling", "hollow"];
  if (facadeType === "coating") return ["crack", "peeling", "hollow"];
  if (facadeType === "panel") return ["damage", "spalling"];
  if (facadeType === "curtain_wall") return ["damage"];
  return ["crack", "spalling", "hollow"];
}

export function StartDetectionModal({
  allowedModelTypes,
  canGenerateBuildingModel = true,
  facadeType,
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
  allowedModelTypes?: DetectionModelType[];
  canGenerateBuildingModel?: boolean;
  facadeType?: FacadeType;
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
  const resolvedModelTypes = allowedModelTypes ?? detectionTypesForFacade(facadeType);
  const allowedModelKey = resolvedModelTypes.join(",");
  const availableOptions = DETECTION_TYPE_OPTIONS.filter((option) => (
    resolvedModelTypes.includes(option.value)
  ));

  useEffect(() => {
    if (!isOpen) return;
    const firstVisibleModel = resolvedModelTypes.find((model) => model !== "hollow");
    setModelTypes(
      thermalPhotoCount > 0
        ? visiblePhotoCount > 0
          ? [...(firstVisibleModel ? [firstVisibleModel] : []), "hollow"]
          : ["hollow"]
        : firstVisibleModel
          ? [firstVisibleModel]
          : []
    );
    setGenerateBuildingModel(false);
    setLocalError("");
  }, [allowedModelKey, isOpen, thermalPhotoCount, visiblePhotoCount]);

  useEffect(() => {
    setModelTypes((current) => current.filter((model) => resolvedModelTypes.includes(model)));
  }, [allowedModelKey]);

  useEffect(() => {
    if (!canGenerateBuildingModel) setGenerateBuildingModel(false);
  }, [canGenerateBuildingModel]);

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
      && !modelTypes.some((model) => model !== "hollow")
    ) {
      setLocalError("可见光图片需要选择一种可见缺陷，请勾选后重试或移除可见光图片。");
      return;
    }
    onOpenChange(false);
    onSubmit({
      generate_building_model: isProfessional && canGenerateBuildingModel && generateBuildingModel,
      model_types: modelTypes
    });
  };

  return (
    <>
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
              aria-label="关闭检测设置弹窗"
              className="start-detection-modal-close back-cancel-button"
              disabled={isPending}
              type="button"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
            <ModalHeader className="start-detection-modal-header">
              <span className="start-detection-modal-title-copy">
                检测设置
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
                  {availableOptions.map((option) => (
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
                  <label
                    aria-disabled={!canGenerateBuildingModel}
                    className="start-detection-addon-option"
                    title={canGenerateBuildingModel ? undefined : "使用此功能需提升到专业版"}
                  >
                    <strong className="start-detection-addon-copy">生成三维模型</strong>
                    <input
                      checked={generateBuildingModel}
                      className="sr-only"
                      disabled={isPending || !canGenerateBuildingModel}
                      type="checkbox"
                      onChange={(event) => setGenerateBuildingModel(event.target.checked)}
                    />
                    <span aria-hidden="true" className="start-detection-addon-switch">
                      <span />
                    </span>
                  </label>
                  <p className={`start-detection-addon-hint${generateBuildingModel ? " is-enabled" : ""}`}>
                    {!canGenerateBuildingModel
                      ? "使用此功能需提升到专业版"
                      : generateBuildingModel
                      ? "为了获得最佳结果，请确保您采集的照片具有良好的GPS、重叠、光照和距离"
                      : "基于无人机照片生成建筑三维模型"}
                  </p>
                </fieldset>
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
                开始检测
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
      </Modal>
      <ErrorNoticeModal
        message={localError}
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen) setLocalError("");
        }}
      />
    </>
  );
}
