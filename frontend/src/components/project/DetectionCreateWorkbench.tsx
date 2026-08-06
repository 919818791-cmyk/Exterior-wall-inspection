import { Images, ScanSearch } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { ProjectWorkbenchShell } from "@/components/project/ProjectWorkbenchShell";

const ORIGINAL_EXAMPLES = ["裂缝.jpeg", "剥落.jpg", "空鼓.JPG"] as const;
const ANNOTATED_EXAMPLES = ["裂缝标注图.jpeg", "剥落标注图.png", "空鼓标注图.png"] as const;

export function DetectionCreateWorkbench({
  ariaLabel,
  feedback,
  guideDescription,
  nameActions,
  nameField,
  photoHeadingStatus,
  photoWorkspaceContent,
  photoUploader,
  title
}: {
  ariaLabel: string;
  feedback?: ReactNode;
  guideDescription: ReactNode;
  nameActions: ReactNode;
  nameField: ReactNode;
  photoHeadingStatus: ReactNode;
  photoWorkspaceContent?: ReactNode;
  photoUploader: ReactNode;
  title: string;
}) {
  return (
    <ProjectWorkbenchShell actionLabel="返回" hideHeader>
      <DetectionCreateWorkspace
        ariaLabel={ariaLabel}
        feedback={feedback}
        guideDescription={guideDescription}
        nameActions={nameActions}
        nameField={nameField}
        photoHeadingStatus={photoHeadingStatus}
        photoWorkspaceContent={photoWorkspaceContent}
        photoUploader={photoUploader}
        title={title}
      />
    </ProjectWorkbenchShell>
  );
}

export function DetectionCreateWorkspace({
  ariaLabel,
  feedback,
  guideDescription,
  nameActions,
  nameField,
  photoHeadingStatus,
  photoWorkspaceContent,
  photoUploader,
  title
}: {
  ariaLabel: string;
  feedback?: ReactNode;
  guideDescription?: ReactNode;
  nameActions: ReactNode;
  nameField: ReactNode;
  photoHeadingStatus?: ReactNode;
  photoWorkspaceContent?: ReactNode;
  photoUploader?: ReactNode;
  title: string;
}) {
  return (
    <div className={`trial-new-project-layout${guideDescription ? "" : " is-guide-hidden"}`}>
      <form className="create-workspace" onSubmit={(event) => event.preventDefault()}>
        <h1 className="sr-only">{title}</h1>
        <section className="project-editor-panel" aria-label={ariaLabel}>
          <div className="project-fields project-editor-basic-fields">
            {nameField}
            <div className="trial-name-actions">{nameActions}</div>
          </div>

          <div className="project-editor-photo-block">
            {photoWorkspaceContent ?? (
              <section className="project-photo-workspace" aria-label="检测照片">
                <header className="project-photo-workspace-heading">
                  <h2>检测照片</h2>
                  <div className="new-project-photo-heading-status">{photoHeadingStatus}</div>
                </header>
                {photoUploader}
              </section>
            )}
          </div>

          {feedback ? (
            <section className="trial-project-feedback" aria-live="polite">
              {feedback}
            </section>
          ) : null}
        </section>
      </form>
      {guideDescription ? <DetectionGuidePanel description={guideDescription} /> : null}
    </div>
  );
}

export function DetectionGuidePanel({ description }: { description: ReactNode }) {
  const [activeTab, setActiveTab] = useState<"original" | "annotated">("original");
  const id = useId().replace(/:/g, "");
  const originalTabId = `${id}-guide-original-tab`;
  const annotatedTabId = `${id}-guide-annotated-tab`;
  const originalPanelId = `${id}-guide-original-examples`;
  const annotatedPanelId = `${id}-guide-annotated-examples`;

  return (
    <aside className="trial-guide-panel" aria-label="检测说明">
      <div className="trial-guide-list">
        <article className="trial-guide-card trial-guide-card-detection">
          <span className="trial-guide-icon" aria-hidden="true"><ScanSearch /></span>
          <div><p>{description}</p></div>
        </article>
        <article className="trial-guide-card trial-guide-card-photo">
          <span className="trial-guide-icon" aria-hidden="true"><Images /></span>
          <div><p>上传画面清晰、墙面完整且无遮挡的照片。</p></div>
        </article>
        <article className="trial-guide-card trial-guide-example-card">
          <div className="trial-guide-example-tabs" role="tablist" aria-label="示例图片类型">
            <button
              aria-controls={originalPanelId}
              aria-selected={activeTab === "original"}
              className={activeTab === "original" ? "is-active" : ""}
              id={originalTabId}
              onClick={() => setActiveTab("original")}
              role="tab"
              type="button"
            >
              原图示例
            </button>
            <button
              aria-controls={annotatedPanelId}
              aria-selected={activeTab === "annotated"}
              className={activeTab === "annotated" ? "is-active" : ""}
              id={annotatedTabId}
              onClick={() => setActiveTab("annotated")}
              role="tab"
              type="button"
            >
              标注示例
            </button>
          </div>
          {activeTab === "original" ? (
            <div
              aria-labelledby={originalTabId}
              className="trial-guide-example-images"
              id={originalPanelId}
              role="tabpanel"
            >
              {ORIGINAL_EXAMPLES.map((filename) => (
                <figure className="trial-guide-example-item" key={filename}>
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt={`${filename.replace(/\.[^.]+$/, "")}检测原图示例`}
                      loading="lazy"
                      src={`/images/trial/examples/original/${filename}`}
                    />
                  </div>
                  <figcaption>{filename.replace(/\.[^.]+$/, "")}原图</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div
              aria-labelledby={annotatedTabId}
              className="trial-guide-example-images"
              id={annotatedPanelId}
              role="tabpanel"
            >
              {ANNOTATED_EXAMPLES.map((filename) => (
                <figure className="trial-guide-example-item" key={filename}>
                  <div className="trial-guide-example-image-frame">
                    <img
                      alt={`${filename.replace("标注图", "").replace(/\.[^.]+$/, "")}检测标注结果示例`}
                      loading="lazy"
                      src={`/images/trial/examples/annotated/${filename}`}
                    />
                  </div>
                  <figcaption>{filename.replace(/\.[^.]+$/, "")}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </article>
      </div>
    </aside>
  );
}
