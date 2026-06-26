import { Button, Card, CardBody, Checkbox, Divider } from "@heroui/react";
import { Download, FileSearch, ImageUp, RotateCcw, Sparkles } from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";

import { downloadTrialReportDocx } from "@/api/reports";
import { saveBlobAsFile } from "@/utils/download";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MODEL_OPTIONS = ["裂缝", "剥落"] as const;

type TrialModel = (typeof MODEL_OPTIONS)[number];

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

export function TrialExperiencePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [models, setModels] = useState<TrialModel[]>([...MODEL_OPTIONS]);
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const updateFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const originalCount = event.target.files?.length ?? 0;
    const selected = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/")
    );

    if (selected.length !== originalCount) {
      setError("仅支持图片文件。");
      event.target.value = "";
      return;
    }

    const selectedBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (selectedBytes > MAX_UPLOAD_BYTES) {
      setError("单次上传总量不能超过 100MB。");
      event.target.value = "";
      return;
    }

    setFiles(selected);
    setGeneratedAt(null);
    setError("");
  };

  const toggleModel = (model: TrialModel) => {
    setModels((current) => {
      if (current.includes(model)) {
        const next = current.filter((item) => item !== model);
        return next.length ? next : current;
      }
      return [...current, model];
    });
    setGeneratedAt(null);
  };

  const reset = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFiles([]);
    setError("");
    setGeneratedAt(null);
  };

  const generateReport = () => {
    if (!files.length) {
      setError("请先上传照片。");
      return;
    }

    setError("");
    setGeneratedAt(
      new Date()
        .toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        })
        .replace(/\//g, "-")
    );
  };

  const downloadReport = async () => {
    if (!generatedAt) return;
    setIsDownloading(true);
    setError("");

    try {
      const findings = files.slice(0, 5).map((file, index) => ({
        filename: file.name,
        model: models[index % models.length],
        confidence: `${84 + (index % 10)}%`
      }));
      const blob = await downloadTrialReportDocx({
        generated_at: generatedAt,
        models,
        files: files.map((file) => ({
          filename: file.name,
          size: file.size
        })),
        findings
      });
      saveBlobAsFile(blob, `简易试用报告-${generatedAt.replace(/[\\s:-]/g, "")}.docx`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载报告失败。");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-action">AI Detection Experience</p>
          <h1 className="mt-2 text-3xl font-black text-ink">AI检测体验</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-7 text-slate-600">
            直接上传照片，生成裂缝/剥落标准检测简易报告。
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="gap-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-ink">上传照片</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  单次上传总量不超过 100MB。
                </p>
              </div>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-action">
                标准检测
              </span>
            </div>

            <label className="grid min-h-48 cursor-pointer place-items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-action hover:bg-blue-50">
              <ImageUp className="h-10 w-10 text-action" aria-hidden="true" />
              <strong className="text-base text-ink">选择外墙照片</strong>
              <span className="text-sm font-semibold text-slate-500">
                支持 JPG、PNG、WebP 等常见图片格式，可多选
              </span>
              <span className="text-xs font-bold text-slate-500">
                {files.length ? `已选择 ${files.length} 张 · ${formatBytes(totalBytes)}` : "尚未选择文件"}
              </span>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={updateFiles}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              {MODEL_OPTIONS.map((model) => (
                <Checkbox
                  key={model}
                  classNames={{
                    base: "m-0 max-w-none rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-none",
                    label: "font-bold text-slate-700"
                  }}
                  isSelected={models.includes(model)}
                  onValueChange={() => toggleModel(model)}
                >
                  {model}
                </Checkbox>
              ))}
            </div>

            <div className="grid gap-2">
              {files.length ? (
                files.slice(0, 8).map((file) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-bold text-slate-700">{file.name}</span>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                  暂无照片
                </div>
              )}
            </div>

            {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                className="rounded-lg border border-slate-300 bg-white font-bold text-slate-700 shadow-none"
                startContent={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                variant="flat"
                onPress={reset}
              >
                重新选择
              </Button>
              <Button
                className="rounded-lg font-bold"
                color="primary"
                startContent={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                onPress={generateReport}
              >
                立即生成简易报告
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="rounded-lg border border-slate-200 shadow-none">
          <CardBody className="gap-5 p-5">
            {generatedAt ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase text-action">Simple Report</p>
                    <h2 className="mt-1 text-xl font-black text-ink">简易检测报告</h2>
                  </div>
                  <span className="text-xs font-bold text-slate-500">{generatedAt}</span>
                </div>
                <Divider />
                <div className="grid gap-3">
                  <div className="rounded-lg bg-slate-50 p-4">
                    <span className="text-xs font-bold text-slate-500">照片数量</span>
                    <strong className="mt-1 block text-2xl font-black text-ink">{files.length}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-4">
                    <span className="text-xs font-bold text-slate-500">检测类型</span>
                    <strong className="mt-1 block text-lg font-black text-ink">
                      {models.join(" / ")}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-4">
                    <span className="text-xs font-bold text-slate-500">检测模式</span>
                    <strong className="mt-1 block text-lg font-black text-ink">标准</strong>
                  </div>
                </div>
                <div className="grid gap-2">
                  {files.slice(0, 5).map((file, index) => (
                    <div
                      key={`finding-${file.name}-${index}`}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex justify-between gap-3">
                        <span className="font-black text-slate-800">
                          {models[index % models.length]}疑似区域
                        </span>
                        <span className="font-black text-action">{84 + (index % 10)}%</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-500">{file.name}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm font-semibold leading-6 text-slate-500">
                  体验结果不存档、不进入审核、不触发正式检测任务。
                </p>
                <Button
                  className="rounded-lg font-bold"
                  color="primary"
                  isLoading={isDownloading}
                  startContent={<Download className="h-4 w-4" aria-hidden="true" />}
                  onPress={() => void downloadReport()}
                >
                  下载 DOCX
                </Button>
              </>
            ) : (
              <div className="grid min-h-[420px] place-items-center text-center">
                <div>
                  <FileSearch className="mx-auto h-11 w-11 text-slate-400" aria-hidden="true" />
                  <h2 className="mt-4 text-xl font-black text-ink">等待生成报告</h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    选择图片后点击“立即生成简易报告”。
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
