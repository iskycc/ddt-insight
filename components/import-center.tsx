"use client";

import {
  AlertTriangle,
  Check,
  CircleStop,
  Download,
  FileArchive,
  FileSpreadsheet,
  History,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CustomSelect } from "@/components/custom-controls";
import styles from "@/components/import-center.module.css";

type ConflictStrategy = "overwrite" | "skip" | "error";
type JobStatus =
  | "previewing"
  | "previewed"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface ImportFileSnapshot {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  totalRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  importedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  error: string;
}

export interface ImportJobSnapshot {
  id: string;
  status: JobStatus;
  strategy: ConflictStrategy;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    provider: string;
  };
  totals: {
    files: number;
    rows: number;
    newRows: number;
    changedRows: number;
    unchangedRows: number;
  };
  progress: {
    files: number;
    rows: number;
    percent: number;
  };
  result: {
    inserted: number;
    updated: number;
    skipped: number;
    unchanged: number;
    failedFiles: number;
  };
  files: ImportFileSnapshot[];
  errors: Array<{ fileName: string; error: string }>;
  canExportCaseIds: boolean;
  canStart: boolean;
  canCancel: boolean;
  createdAt: string;
  startedAt: string;
  completedAt: string;
}

export interface ImportCenterProps {
  onClose: () => void;
  onImported: () => Promise<void> | void;
  onToast: (message: string) => void;
}

const strategyOptions = [
  { value: "overwrite", label: "覆盖已有用例" },
  { value: "skip", label: "跳过已有用例" },
  { value: "error", label: "发现冲突即终止" },
];

const statusLabels: Record<JobStatus, string> = {
  previewing: "正在预检",
  previewed: "等待确认",
  queued: "等待执行",
  running: "正在导入",
  completed: "导入完成",
  failed: "导入失败",
  cancelled: "已取消",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(value / 1024, 0.1).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isTerminal(status: JobStatus) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function hasFileError(file: ImportFileSnapshot) {
  return file.status === "failed" || Boolean(file.error);
}

function getFileStatusLabel(file: ImportFileSnapshot, jobStatus?: JobStatus) {
  if (hasFileError(file)) return "未导入";
  if (file.status === "completed") return "已处理";
  if (file.status === "importing") return "导入中";
  if (file.status === "cancelled") return "已取消";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "未处理";
  return "可导入";
}

function getFileStatusDetail(file: ImportFileSnapshot, jobStatus?: JobStatus) {
  if (file.error) return file.error;
  if (file.status === "completed") {
    return `新增 ${file.insertedRows} · 覆盖 ${file.updatedRows} · 跳过 ${file.skippedRows + file.unchangedRows}`;
  }
  if (file.status === "importing") return `正在处理 ${file.totalRows} 行用例`;
  if (file.status === "cancelled") return "任务取消前未写入该表格";
  if (jobStatus === "failed") return "任务终止，未写入该表格";
  if (jobStatus === "cancelled") return "任务已取消，未写入该表格";
  return `${file.totalRows} 行 · 新增 ${file.newRows} · 覆盖 ${file.changedRows} · 无变化 ${file.unchangedRows}`;
}

export function ImportCenter({
  onClose,
  onImported,
  onToast,
}: ImportCenterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const notifiedJobRef = useRef("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] =
    useState<ConflictStrategy>("overwrite");
  const [job, setJob] = useState<ImportJobSnapshot | null>(null);
  const [requestError, setRequestError] = useState("");

  const pollJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/import/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as ImportJobSnapshot & {
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "无法获取导入进度");
    setJob(body);
    return body;
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const update = async () => {
      try {
        const next = await pollJob(job.id);
        if (!disposed && !isTerminal(next.status)) {
          timer = setTimeout(update, 800);
        }
      } catch (error) {
        if (!disposed) {
          setRequestError(
            error instanceof Error ? error.message : "读取进度失败",
          );
          timer = setTimeout(update, 2_000);
        }
      }
    };
    timer = setTimeout(update, 500);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [job?.id, job?.status, pollJob]);

  useEffect(() => {
    if (!job || !isTerminal(job.status) || notifiedJobRef.current === job.id) {
      return;
    }
    notifiedJobRef.current = job.id;
    const writtenRows = job.result.inserted + job.result.updated;
    if (job.status === "completed" || writtenRows > 0) {
      void Promise.resolve()
        .then(() => onImported())
        .then(() => {
          const excludedMessage = job.result.failedFiles
            ? `，${numberFormatter.format(job.result.failedFiles)} 个问题表格未导入，原因已记录`
            : "";
          onToast(
            job.status === "completed"
              ? `导入完成：新增 ${numberFormatter.format(job.result.inserted)} 条，覆盖 ${numberFormatter.format(job.result.updated)} 条${excludedMessage}`
              : `部分文件已写入：新增 ${numberFormatter.format(job.result.inserted)} 条，覆盖 ${numberFormatter.format(job.result.updated)} 条${excludedMessage}`,
          );
        })
        .catch(() => {
          setRequestError("导入已完成，但工作台刷新失败，请手动刷新页面");
        });
    }
  }, [job, onImported, onToast]);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  function addFiles(incoming: File[]) {
    const unique = new Map(
      files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]),
    );
    for (const file of incoming) {
      unique.set(`${file.name}:${file.size}:${file.lastModified}`, file);
    }
    setFiles([...unique.values()].slice(0, 30));
    setJob(null);
    setRequestError("");
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  async function preview() {
    if (!files.length) return;
    setBusy(true);
    setRequestError("");
    const formData = new FormData();
    for (const file of files) formData.append("files", file);

    try {
      const response = await fetch("/api/import/preview", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as ImportJobSnapshot & {
        error?: string;
      };
      if (!response.ok && !body.id) {
        throw new Error(body.error ?? "导入预检失败");
      }
      setJob(body);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "导入预检失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!job?.canStart) return;
    setBusy(true);
    setRequestError("");
    try {
      const response = await fetch("/api/import/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, strategy }),
      });
      const body = (await response.json()) as ImportJobSnapshot & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "无法开始导入");
      setJob(body);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "无法开始导入",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job?.canCancel) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/import/jobs/${encodeURIComponent(job.id)}/cancel`,
        { method: "POST" },
      );
      const body = (await response.json()) as ImportJobSnapshot & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "无法取消导入");
      setJob(body);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "无法取消导入",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPreview() {
    if (!job || job.status !== "previewed") return;
    setBusy(true);
    try {
      await fetch(`/api/import/jobs/${encodeURIComponent(job.id)}/cancel`, {
        method: "POST",
      });
      setJob(null);
      setRequestError("");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (job?.status === "previewed") {
      void fetch(`/api/import/jobs/${encodeURIComponent(job.id)}/cancel`, {
        method: "POST",
      });
    }
    onClose();
  }

  const locked = busy || job?.status === "queued" || job?.status === "running";
  const importableFiles =
    job?.files.filter((file) => !hasFileError(file)) ?? [];
  const excludedFiles = job?.files.filter(hasFileError) ?? [];
  const excludedCount = Math.max(
    excludedFiles.length,
    job?.result.failedFiles ?? 0,
  );

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (!locked && event.currentTarget === event.target) close();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-center-title"
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.headingIcon}>
              <UploadCloud size={21} />
            </span>
            <div>
              <h2 id="import-center-title">导入用例</h2>
              <p>先预检影响范围，再在后台安全写入</p>
            </div>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭导入中心"
            disabled={locked}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>

        <div className={styles.content}>
          {!job && (
            <>
              <div
                className={`${styles.dropzone} ${
                  dragging ? styles.dragging : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb,.csv,.ods,.zip"
                  multiple
                  onChange={handleFileInput}
                />
                <span className={styles.dropIcon}>
                  <UploadCloud size={28} />
                </span>
                <strong>拖放表格或 ZIP 到这里</strong>
                <p>
                  支持 data 或 step1–stepN；ZIP 读取根目录/一层子目录，最多 30 个
                </p>
                <button
                  className={styles.browseButton}
                  type="button"
                  onClick={() => inputRef.current?.click()}
                >
                  浏览本机文件
                </button>
              </div>

              {!!files.length && (
                <div className={styles.fileList}>
                  <div className={styles.sectionHeading}>
                    <strong>等待预检</strong>
                    <span>{files.length} 个文件</span>
                  </div>
                  {files.map((file) => (
                    <div
                      className={styles.fileRow}
                      key={`${file.name}:${file.size}:${file.lastModified}`}
                    >
                      {file.name.toLocaleLowerCase("en-US").endsWith(".zip") ? (
                        <FileArchive size={18} />
                      ) : (
                        <FileSpreadsheet size={18} />
                      )}
                      <div>
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size)}</span>
                      </div>
                      <button
                        className={styles.iconButton}
                        type="button"
                        aria-label={`移除 ${file.name}`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((item) => item !== file),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {job && (
            <>
              <div className={styles.statusLine}>
                <span
                  className={`${styles.statusDot} ${styles[job.status]}`}
                  aria-hidden="true"
                />
                <strong>{statusLabels[job.status]}</strong>
                <code>{job.id.slice(0, 8)}</code>
              </div>

              <div className={styles.metrics}>
                <article>
                  <span>总行数</span>
                  <strong>{numberFormatter.format(job.totals.rows)}</strong>
                </article>
                <article className={styles.added}>
                  <span>新增</span>
                  <strong>{numberFormatter.format(job.totals.newRows)}</strong>
                </article>
                <article className={styles.changed}>
                  <span>覆盖</span>
                  <strong>{numberFormatter.format(job.totals.changedRows)}</strong>
                </article>
                <article>
                  <span>无变化</span>
                  <strong>{numberFormatter.format(job.totals.unchangedRows)}</strong>
                </article>
              </div>

              {["queued", "running"].includes(job.status) && (
                <div className={styles.progressBlock}>
                  <div>
                    <span>后台导入进度</span>
                    <strong>{job.progress.percent}%</strong>
                  </div>
                  <span className={styles.progressTrack}>
                    <span style={{ width: `${job.progress.percent}%` }} />
                  </span>
                  <small>
                    已处理 {job.progress.files}/{job.totals.files} 个文件，
                    {numberFormatter.format(job.progress.rows)}/
                    {numberFormatter.format(job.totals.rows)} 行
                  </small>
                </div>
              )}

              {job.status === "previewed" && (
                <div className={styles.strategy}>
                  <div className={styles.strategyCopy}>
                    <strong>冲突处理策略</strong>
                    <span>
                      {strategy === "overwrite"
                        ? "写入新用例，并覆盖内容有变化的已有用例"
                        : strategy === "skip"
                          ? "仅写入新用例，已有 CaseID 全部跳过"
                          : "只要存在覆盖冲突，整个任务都不会开始"}
                    </span>
                  </div>
                  <CustomSelect
                    value={strategy}
                    options={strategyOptions}
                    onChange={(value) =>
                      setStrategy(value as ConflictStrategy)
                    }
                    ariaLabel="导入冲突处理策略"
                    className={styles.strategySelect}
                    menuClassName={styles.strategyMenu}
                  />
                </div>
              )}

              {job.status === "previewed" && excludedCount > 0 && (
                <div className={styles.partialNotice} role="status">
                  <span className={styles.partialNoticeIcon}>
                    <AlertTriangle size={18} />
                  </span>
                  <div>
                    <strong>
                      已排除 {excludedCount} 个问题表格，可继续导入{" "}
                      {importableFiles.length} 个
                    </strong>
                    <span>
                      被排除的表格不会写入；表格名称和失败原因会永久保留在“导入来源”中。
                    </span>
                  </div>
                </div>
              )}

              {job.errors.length > 0 && (
                <div className={styles.previewErrors}>
                  <div className={styles.sectionHeading}>
                    <strong>
                      {job.status === "previewed"
                        ? "将排除的问题表格"
                        : "未导入的问题表格"}
                    </strong>
                    <span>{job.errors.length} 项</span>
                  </div>
                  {job.errors.map((error, index) => (
                    <div
                      className={styles.previewError}
                      key={`${error.fileName}:${index}`}
                    >
                      <span className={styles.fileErrorIcon}>
                        <AlertTriangle size={16} />
                      </span>
                      <div>
                        <strong>{error.fileName}</strong>
                        <small>{error.error}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.previewFiles}>
                <div className={styles.sectionHeading}>
                  <strong>
                    {job.status === "previewed"
                      ? "可导入表格"
                      : job.status === "completed"
                        ? "已处理表格"
                        : "表格状态"}
                  </strong>
                  <span>{importableFiles.length} 项</span>
                </div>
                {importableFiles.map((file) => (
                  <div className={styles.previewFile} key={file.id}>
                    <span className={styles.fileOkIcon}>
                      <Check size={16} />
                    </span>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>{getFileStatusDetail(file, job.status)}</small>
                    </div>
                  </div>
                ))}
                {!importableFiles.length && (
                  <div className={styles.noImportableFiles}>
                    没有通过校验的表格，无法启动导入
                  </div>
                )}
              </div>

              {job.status === "completed" && (
                <div
                  className={`${styles.resultBanner} ${
                    job.result.failedFiles > 0 ? styles.partialResult : ""
                  }`}
                >
                  {job.result.failedFiles > 0 ? (
                    <AlertTriangle size={18} />
                  ) : (
                    <Check size={18} />
                  )}
                  <span>
                    {job.result.failedFiles > 0 ? "有效表格已完成：" : ""}
                    实际新增 {job.result.inserted} 条，覆盖 {job.result.updated}
                    条，跳过 {job.result.skipped} 条
                    {job.result.failedFiles > 0
                      ? `；${job.result.failedFiles} 个问题表格未导入，原因已记录`
                      : ""}
                  </span>
                </div>
              )}
            </>
          )}

          {Boolean(requestError) && (
            <div className={styles.errors} role="alert">
              <p>{requestError}</p>
            </div>
          )}
        </div>

        <footer className={styles.actions}>
          {job?.canCancel && (
            <button
              className={styles.cancelButton}
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              <CircleStop size={16} />
              取消任务
            </button>
          )}
          <span />
          {job?.canExportCaseIds && (
            <a
              className={styles.secondaryButton}
              href={`/api/import/jobs/${encodeURIComponent(job.id)}/case-ids`}
              download
            >
              <Download aria-hidden="true" focusable="false" size={16} />
              导出全部 CaseID
            </a>
          )}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={locked}
            onClick={() =>
              job?.status === "previewed" ? void resetPreview() : close()
            }
          >
            {job?.status === "previewed"
              ? "重新选择"
              : job && isTerminal(job.status)
                ? "关闭"
                : "返回"}
          </button>
          {!job && (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={!files.length || busy}
              onClick={() => void preview()}
            >
              {busy ? (
                <LoaderCircle className={styles.spin} size={17} />
              ) : (
                <Search size={17} />
              )}
              {busy ? "正在预检" : "开始预检"}
            </button>
          )}
          {job?.status === "previewed" && (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy || !job.canStart}
              onClick={() => void start()}
            >
              {busy ? (
                <LoaderCircle className={styles.spin} size={17} />
              ) : (
                <Play size={17} />
              )}
              {excludedCount > 0
                ? `排除 ${excludedCount} 个并导入`
                : "启动后台导入"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

interface SourceResponse {
  items: ImportJobSnapshot[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

export function ImportSourceTracker({
  currentUserId,
  canExportAll,
  canExportOwn,
}: {
  currentUserId: string;
  canExportAll: boolean;
  canExportOwn: boolean;
}) {
  const [items, setItems] = useState<ImportJobSnapshot[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [strategy, setStrategy] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({
      limit: "20",
      offset: String(offset),
    });
    if (query.trim()) parameters.set("query", query.trim());
    if (status) parameters.set("status", status);
    if (strategy) parameters.set("strategy", strategy);
    try {
      const response = await fetch(`/api/admin/imports?${parameters}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as SourceResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "无法读取导入来源");
      setItems(body.items);
      setHasMore(body.hasMore);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法读取导入来源",
      );
    } finally {
      setLoading(false);
    }
  }, [offset, query, status, strategy]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="workspace-page">
      <section className={styles.sourcePanel}>
      <header className={styles.sourceHeader}>
        <div>
          <span className={styles.headingIcon}>
            <History size={20} />
          </span>
          <div>
            <h2>导入来源</h2>
            <p>按批次追踪来源表格、排除原因、执行策略与实际影响</p>
          </div>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="刷新导入来源"
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? styles.spin : ""} size={17} />
        </button>
      </header>

      <div className={styles.filters}>
        <label className={styles.searchField}>
          <Search size={16} />
          <input
            value={query}
            placeholder="搜索任务、操作人或文件名"
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <CustomSelect
          value={status}
          options={[
            { value: "", label: "全部状态" },
            { value: "completed", label: "已完成" },
            { value: "failed", label: "失败" },
            { value: "cancelled", label: "已取消" },
            { value: "running", label: "执行中" },
            { value: "queued", label: "排队中" },
            { value: "previewed", label: "待确认" },
          ]}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
          ariaLabel="筛选导入状态"
        />
        <CustomSelect
          value={strategy}
          options={[
            { value: "", label: "全部策略" },
            ...strategyOptions,
          ]}
          onChange={(value) => {
            setStrategy(value);
            setOffset(0);
          }}
          ariaLabel="筛选冲突策略"
        />
      </div>

      {error && <div className={styles.errors}>{error}</div>}
      <div
        className={`${styles.sourceList} ${
          loading && items.length ? styles.refreshing : ""
        }`}
        aria-busy={loading}
      >
        {items.map((item) => {
          const recordedFileErrors = new Set(
            item.files
              .filter((file) => file.error)
              .map((file) => `${file.fileName}\u0000${file.error}`),
          );
          const additionalErrors = item.errors.filter(
            (itemError) =>
              !recordedFileErrors.has(
                `${itemError.fileName}\u0000${itemError.error}`,
              ),
          );
          const isPartial =
            item.status === "completed" && item.result.failedFiles > 0;
          const canExportItemCaseIds =
            item.canExportCaseIds &&
            (canExportAll ||
              (canExportOwn && item.actor.userId === currentUserId));

          return (
            <article className={styles.sourceCard} key={item.id}>
              <div className={styles.sourceMeta}>
                <span
                  className={`${styles.statusDot} ${styles[
                    isPartial ? "partial" : item.status
                  ]}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>
                    {isPartial ? "部分完成" : statusLabels[item.status]}
                  </strong>
                  <small>
                    {item.actor.displayName || item.actor.username} ·{" "}
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.createdAt))}
                  </small>
                </div>
                <code>{item.id.slice(0, 8)}</code>
              </div>
              <div className={styles.sourceStats}>
                <span>文件 {item.totals.files}</span>
                <span>总计 {item.totals.rows}</span>
                <span>新增 {item.result.inserted}</span>
                <span>覆盖 {item.result.updated}</span>
                <span>跳过 {item.result.skipped + item.result.unchanged}</span>
                {item.result.failedFiles > 0 && (
                  <span className={styles.failedStat}>
                    未导入 {item.result.failedFiles}
                  </span>
                )}
                {canExportItemCaseIds && (
                  <a
                    className={styles.sourceDownload}
                    href={`/api/import/jobs/${encodeURIComponent(item.id)}/case-ids`}
                    download
                  >
                    <Download aria-hidden="true" focusable="false" size={12} />
                    导出 CaseID
                  </a>
                )}
              </div>
              <div className={styles.sourceFiles}>
                {item.files.map((file) => (
                  <div
                    className={`${styles.sourceFile} ${
                      hasFileError(file)
                        ? styles.sourceFileError
                        : file.status === "completed"
                          ? styles.sourceFileSuccess
                          : styles.sourceFilePending
                    }`}
                    key={file.id}
                  >
                    <span className={styles.sourceFileIcon}>
                      {hasFileError(file) ? (
                        <AlertTriangle size={14} />
                      ) : file.status === "completed" ? (
                        <Check size={14} />
                      ) : (
                        <FileSpreadsheet size={14} />
                      )}
                    </span>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>{getFileStatusDetail(file, item.status)}</small>
                    </div>
                    <em>{getFileStatusLabel(file, item.status)}</em>
                  </div>
                ))}
              </div>
              {additionalErrors.length > 0 && (
                <div className={styles.sourceErrors}>
                  <strong>其他任务问题</strong>
                  {additionalErrors.map((error, index) => (
                    <span key={`${error.fileName}:${index}`} title={error.error}>
                      <AlertTriangle size={13} />
                      <em>{error.fileName}</em>
                      <small>{error.error}</small>
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {!loading && !items.length && (
          <div className={styles.empty}>没有符合条件的导入来源记录</div>
        )}
      </div>

      <footer className={styles.pagination}>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={offset === 0 || loading}
          onClick={() => setOffset((value) => Math.max(0, value - 20))}
        >
          上一页
        </button>
        <span>第 {Math.floor(offset / 20) + 1} 页</span>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={!hasMore || loading}
          onClick={() => setOffset((value) => value + 20)}
        >
          下一页
        </button>
      </footer>
      </section>
    </div>
  );
}
