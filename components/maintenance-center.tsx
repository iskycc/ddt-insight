"use client";

import {
  Activity,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  Gauge,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { SystemSettings } from "@/lib/system-settings";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "@/components/maintenance-center.module.css";

type ToastHandler = (message: string) => void;
export type MaintenanceSection =
  | "backup"
  | "diagnostics"
  | "recycle"
  | "settings";

type BackupItem = {
  id: string;
  fileName: string;
  createdAt: string;
  createdBy: string;
  sizeBytes: number;
  databaseBytes: number;
  appVersion: string;
};

type Diagnostics = {
  generatedAt: string;
  status: "healthy" | "attention";
  runtime: {
    node: string;
    appVersion: string;
    sqlite: string;
    uptimeSeconds: number;
  };
  storage: {
    databaseBytes: number;
    walBytes: number;
    shmBytes: number;
    backupBytes: number;
    logicalBytes: number;
    reclaimableBytes: number;
    diskTotalBytes: number;
    diskFreeBytes: number;
    pageSize: number;
    pageCount: number;
    freePages: number;
    tables: Array<{ name: string; bytes: number }>;
  };
  database: {
    journalMode: string;
    foreignKeys: boolean;
    quickCheck: string[];
    foreignKeyIssues: number;
    wal: { busy: number; log: number; checkpointed: number };
  };
  counts: {
    cases: number;
    history: number;
    recycle: number;
    imports: number;
    audit: number;
  };
  pendingRestore: null | {
    stagedAt?: string;
    backupCreatedAt?: string;
    safetyBackupId?: string;
  };
};

type DeletedCase = {
  id: string;
  caseId: string;
  srNum: string;
  sourceName: string;
  updatedAt: string;
  deletedAt: string;
  deletedByUsername: string;
  deletedByDisplayName: string;
  deletedByProvider: string;
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** unit;
  return `${amount >= 100 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function MaintenanceCenter({
  section,
  onToast,
  onCasesChanged,
}: {
  section: MaintenanceSection;
  onToast: ToastHandler;
  onCasesChanged?: () => void;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [deletedCases, setDeletedCases] = useState<DeletedCase[]>([]);
  const [recycleOffset, setRecycleOffset] = useState(0);
  const [recycleHasMore, setRecycleHasMore] = useState(false);
  const [recycleQuery, setRecycleQuery] = useState("");
  const [appliedRecycleQuery, setAppliedRecycleQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupConfirm, setBackupConfirm] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SystemSettings | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "backup"; item: BackupItem }
    | { kind: "purge"; item: DeletedCase }
    | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDiagnostics = useCallback(async () => {
    const response = await fetch("/api/admin/maintenance", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await responseError(response, "读取诊断信息失败"));
    }
    setDiagnostics((await response.json()) as Diagnostics);
  }, []);

  const loadBackups = useCallback(async () => {
    const response = await fetch("/api/admin/maintenance/backups", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await responseError(response, "读取备份列表失败"));
    }
    const body = (await response.json()) as { items: BackupItem[] };
    setBackups(body.items);
  }, []);

  const loadRecycle = useCallback(async () => {
    const parameters = new URLSearchParams({
      query: appliedRecycleQuery,
      limit: "30",
      offset: String(recycleOffset),
    });
    const response = await fetch(`/api/admin/recycle?${parameters}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await responseError(response, "读取回收站失败"));
    }
    const body = (await response.json()) as {
      items: DeletedCase[];
      hasMore: boolean;
    };
    setDeletedCases(body.items);
    setRecycleHasMore(body.hasMore);
  }, [appliedRecycleQuery, recycleOffset]);

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/admin/settings", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await responseError(response, "读取系统配置失败"));
    }
    const body = (await response.json()) as SystemSettings;
    setSettings(body);
    setSettingsDraft(body);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (section === "backup") {
        await Promise.all([loadDiagnostics(), loadBackups()]);
      } else if (section === "diagnostics") {
        await loadDiagnostics();
      } else if (section === "settings") {
        await loadSettings();
      } else {
        await loadRecycle();
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "读取运维信息失败",
      );
    } finally {
      setLoading(false);
    }
  }, [loadBackups, loadDiagnostics, loadRecycle, loadSettings, section]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createBackup(event: FormEvent) {
    event.preventDefault();
    if (backupPassphrase !== backupConfirm) {
      setError("两次输入的备份口令不一致");
      return;
    }
    setBusy("backup-create");
    setError("");
    try {
      const response = await fetch("/api/admin/maintenance/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: backupPassphrase }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "创建备份失败"));
      }
      const backup = (await response.json()) as BackupItem;
      setBackups((current) => [backup, ...current]);
      setBackupPassphrase("");
      setBackupConfirm("");
      onToast("一致性加密备份已创建");
      await loadDiagnostics();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "创建备份失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup(event: FormEvent) {
    event.preventDefault();
    if (!restoreFile) {
      setError("请先选择 .ddtbackup 备份文件");
      return;
    }
    setBusy("restore");
    setError("");
    try {
      const response = await fetch("/api/admin/maintenance/restore", {
        method: "POST",
        headers: {
          "X-DDT-Backup-Passphrase": encodeURIComponent(restorePassphrase),
        },
        body: restoreFile,
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "恢复备份失败"));
      }
      setRestoreFile(null);
      setRestorePassphrase("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onToast("恢复已安全暂存，请重启服务使其生效");
      await Promise.all([loadDiagnostics(), loadBackups()]);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : "恢复备份失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function runCheckpoint() {
    setBusy("checkpoint");
    setError("");
    try {
      const response = await fetch("/api/admin/maintenance/checkpoint", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "检查点执行失败"));
      }
      onToast("WAL 检查点已完成");
      await loadDiagnostics();
    } catch (checkpointError) {
      setError(
        checkpointError instanceof Error
          ? checkpointError.message
          : "检查点执行失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settingsDraft) return;
    setBusy("settings-save");
    setError("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "保存系统配置失败"));
      }
      const body = (await response.json()) as SystemSettings;
      setSettings(body);
      setSettingsDraft(body);
      onToast("系统配置已保存");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存系统配置失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function cancelRestore() {
    setBusy("restore-cancel");
    setError("");
    try {
      const response = await fetch("/api/admin/maintenance/restore", {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "取消恢复失败"));
      }
      onToast("等待重启的恢复任务已取消");
      await loadDiagnostics();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "取消恢复失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function deleteBackup(item: BackupItem) {
    setBusy(`backup-${item.id}`);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/maintenance/backups/${item.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "删除备份失败"));
      }
      setBackups((current) =>
        current.filter((backup) => backup.id !== item.id),
      );
      setConfirmAction(null);
      onToast("备份文件已删除");
      await loadDiagnostics();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "删除备份失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function restoreCase(item: DeletedCase) {
    setBusy(`recycle-${item.id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/recycle/${item.id}/restore`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "恢复用例失败"));
      }
      setDeletedCases((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
      onToast(`已从回收站恢复 ${item.caseId}`);
      onCasesChanged?.();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : "恢复用例失败",
      );
    } finally {
      setBusy("");
    }
  }

  async function purgeCase(item: DeletedCase) {
    setBusy(`recycle-${item.id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/recycle/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "彻底删除失败"));
      }
      setDeletedCases((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
      setConfirmAction(null);
      onToast(`已彻底删除 ${item.caseId}，修改历史仍永久保留`);
    } catch (purgeError) {
      setError(
        purgeError instanceof Error ? purgeError.message : "彻底删除失败",
      );
    } finally {
      setBusy("");
    }
  }

  function searchRecycle(event: FormEvent) {
    event.preventDefault();
    setRecycleOffset(0);
    setAppliedRecycleQuery(recycleQuery.trim());
  }

  function selectRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    setRestoreFile(event.target.files?.[0] ?? null);
  }

  const diskUsage = diagnostics
    ? Math.max(
        0,
        Math.min(
          100,
          ((diagnostics.storage.diskTotalBytes -
            diagnostics.storage.diskFreeBytes) /
            diagnostics.storage.diskTotalBytes) *
            100,
        ),
      )
    : 0;
  const pageCopy = {
    backup: {
      eyebrow: "DATA PROTECTION",
      title: "备份与恢复",
      description:
        "创建离线加密备份，校验恢复文件，并安全暂存等待重启的数据恢复任务。",
    },
    diagnostics: {
      eyebrow: "SYSTEM HEALTH",
      title: "系统信息",
      description:
        "查看运行版本、存储容量、SQLite 完整性和 WAL 检查点状态。",
    },
    settings: {
      eyebrow: "SYSTEM CONFIG",
      title: "系统配置",
      description: "管理导入限制、ZIP 解压策略等运行时参数。",
    },
    recycle: {
      eyebrow: "RECOVERY",
      title: "回收站",
      description:
        "检索、恢复或彻底删除误删用例，同时永久保留既有修改历史。",
    },
  }[section];

  return (
    <div className={`${styles.center} workspace-page admin-page`}>
      <div className={styles.heading}>
        <div>
          <span className="eyebrow">{pageCopy.eyebrow}</span>
          <h1>{pageCopy.title}</h1>
          <p>{pageCopy.description}</p>
        </div>
        <button
          className="button button-quiet button-small"
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? "spin" : ""} size={15} />
          刷新
        </button>
      </div>

      {error && (
        <div className={styles.alert}>
          <CircleAlert size={17} />
          <span>{error}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {section === "backup" && diagnostics?.pendingRestore && (
        <div className={styles.pending}>
          <RefreshCw size={18} />
          <div>
            <strong>恢复任务等待服务重启</strong>
            <span>
              已于{" "}
              {diagnostics.pendingRestore.stagedAt
                ? localDate(diagnostics.pendingRestore.stagedAt)
                : "刚刚"}{" "}
              完成安全校验和暂存，当前服务仍使用原数据库。
            </span>
          </div>
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={busy === "restore-cancel"}
            onClick={() => void cancelRestore()}
          >
            取消恢复
          </button>
        </div>
      )}

      {section === "backup" && (
        <div className={styles.backupLayout}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <span className={styles.iconBlue}>
                <Save size={19} />
              </span>
              <div>
                <h2>创建加密备份</h2>
                <p>SQLite 在线一致性快照与本地密钥会被封装并整体加密。</p>
              </div>
            </div>
            <form className={styles.form} onSubmit={createBackup}>
              <label>
                <span>备份口令</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={256}
                  required
                  value={backupPassphrase}
                  onChange={(event) => setBackupPassphrase(event.target.value)}
                  placeholder="至少 8 个字符，请妥善保管"
                />
              </label>
              <label>
                <span>确认口令</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={256}
                  required
                  value={backupConfirm}
                  onChange={(event) => setBackupConfirm(event.target.value)}
                  placeholder="再次输入备份口令"
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy === "backup-create"}
              >
                {busy === "backup-create" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}
                生成一致性备份
              </button>
            </form>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <span className={styles.iconPurple}>
                <Upload size={19} />
              </span>
              <div>
                <h2>安全恢复</h2>
                <p>先校验口令、哈希、结构、完整性与本地管理员，再等待重启激活。</p>
              </div>
            </div>
            <form className={styles.form} onSubmit={restoreBackup}>
              <button
                className={styles.filePicker}
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} />
                <span>{restoreFile?.name ?? "选择 .ddtbackup 文件"}</span>
              </button>
              <input
                ref={fileInputRef}
                className={styles.hiddenInput}
                type="file"
                accept=".ddtbackup,application/octet-stream"
                onChange={selectRestoreFile}
              />
              <label>
                <span>备份口令</span>
                <input
                  type="password"
                  autoComplete="off"
                  minLength={8}
                  maxLength={256}
                  required
                  value={restorePassphrase}
                  onChange={(event) => setRestorePassphrase(event.target.value)}
                  placeholder="输入创建该备份时的口令"
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy === "restore" || !restoreFile}
              >
                {busy === "restore" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
                校验并暂存恢复
              </button>
            </form>
          </section>

          <section
            className={`${styles.panel} ${styles.backupList} ${
              loading && backups.length ? styles.refreshing : ""
            }`}
            aria-busy={loading}
          >
            <div className={styles.panelHeading}>
              <span className={styles.iconGreen}>
                <Archive size={19} />
              </span>
              <div>
                <h2>本机备份</h2>
                <p>{backups.length} 个加密备份，占用 {formatBytes(diagnostics?.storage.backupBytes ?? 0)}</p>
              </div>
            </div>
            {loading && backups.length === 0 ? (
              <div className={styles.empty}>
                <LoaderCircle className="spin" size={19} />
                正在读取备份…
              </div>
            ) : backups.length ? (
              <div className={styles.list}>
                {backups.map((item) => (
                  <article className={styles.backupItem} key={item.id}>
                    <span className={styles.fileIcon}>
                      <Database size={18} />
                    </span>
                    <div>
                      <strong>{item.fileName}</strong>
                      <small>
                        {localDate(item.createdAt)} · {formatBytes(item.sizeBytes)} ·{" "}
                        {item.createdBy}
                      </small>
                    </div>
                    <div className={styles.rowActions}>
                      <a
                        className="button button-quiet button-small"
                        href={`/api/admin/maintenance/backups/${item.id}/download`}
                        download={item.fileName}
                      >
                        <Download size={14} />
                        下载
                      </a>
                      <button
                        className={styles.iconButton}
                        type="button"
                        aria-label={`删除备份 ${item.fileName}`}
                        onClick={() =>
                          setConfirmAction({ kind: "backup", item })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>还没有创建本机备份</div>
            )}
          </section>
        </div>
      )}

      {section === "diagnostics" && diagnostics && (
        <div className={styles.diagnostics}>
          <div className={styles.metricGrid}>
            <article>
              <span className={styles.iconBlue}>
                <Database size={18} />
              </span>
              <p>
                <small>SQLite 数据库</small>
                <strong>{formatBytes(diagnostics.storage.databaseBytes)}</strong>
                <em>{diagnostics.counts.cases.toLocaleString()} 条用例</em>
              </p>
            </article>
            <article>
              <span className={styles.iconPurple}>
                <Activity size={18} />
              </span>
              <p>
                <small>永久修改历史</small>
                <strong>{diagnostics.counts.history.toLocaleString()}</strong>
                <em>{diagnostics.counts.audit.toLocaleString()} 条审计</em>
              </p>
            </article>
            <article>
              <span className={styles.iconGreen}>
                <HardDrive size={18} />
              </span>
              <p>
                <small>磁盘可用</small>
                <strong>{formatBytes(diagnostics.storage.diskFreeBytes)}</strong>
                <em>已使用 {diskUsage.toFixed(1)}%</em>
              </p>
            </article>
            <article>
              <span
                className={
                  diagnostics.status === "healthy"
                    ? styles.iconGreen
                    : styles.iconOrange
                }
              >
                {diagnostics.status === "healthy" ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <CircleAlert size={18} />
                )}
              </span>
              <p>
                <small>数据库健康</small>
                <strong>
                  {diagnostics.status === "healthy" ? "正常" : "需要关注"}
                </strong>
                <em>{diagnostics.database.foreignKeyIssues} 个外键问题</em>
              </p>
            </article>
          </div>

          <div className={styles.diagnosticColumns}>
            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.iconBlue}>
                  <Gauge size={19} />
                </span>
                <div>
                  <h2>数据库运行状态</h2>
                  <p>采样于 {localDate(diagnostics.generatedAt)}</p>
                </div>
              </div>
              <dl className={styles.details}>
                <div>
                  <dt>完整性检查</dt>
                  <dd>{diagnostics.database.quickCheck.join("、")}</dd>
                </div>
                <div>
                  <dt>Journal 模式</dt>
                  <dd>{diagnostics.database.journalMode.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>WAL 文件</dt>
                  <dd>{formatBytes(diagnostics.storage.walBytes)}</dd>
                </div>
                <div>
                  <dt>WAL 页面</dt>
                  <dd>
                    {diagnostics.database.wal.checkpointed}/
                    {diagnostics.database.wal.log} 已检查点
                  </dd>
                </div>
                <div>
                  <dt>可回收页</dt>
                  <dd>{formatBytes(diagnostics.storage.reclaimableBytes)}</dd>
                </div>
              </dl>
              <button
                className="button button-quiet button-small"
                type="button"
                disabled={busy === "checkpoint"}
                onClick={() => void runCheckpoint()}
              >
                {busy === "checkpoint" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
                执行 WAL 检查点
              </button>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.iconPurple}>
                  <Activity size={19} />
                </span>
                <div>
                  <h2>运行环境</h2>
                  <p>离线交付版本与进程信息</p>
                </div>
              </div>
              <dl className={styles.details}>
                <div>
                  <dt>应用版本</dt>
                  <dd>v{diagnostics.runtime.appVersion}</dd>
                </div>
                <div>
                  <dt>Node.js</dt>
                  <dd>{diagnostics.runtime.node}</dd>
                </div>
                <div>
                  <dt>SQLite</dt>
                  <dd>{diagnostics.runtime.sqlite}</dd>
                </div>
                <div>
                  <dt>持续运行</dt>
                  <dd>{duration(diagnostics.runtime.uptimeSeconds)}</dd>
                </div>
                <div>
                  <dt>页面大小</dt>
                  <dd>{formatBytes(diagnostics.storage.pageSize)}</dd>
                </div>
              </dl>
            </section>
          </div>

          {diagnostics.storage.tables.length > 0 && (
            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.iconGreen}>
                  <HardDrive size={19} />
                </span>
                <div>
                  <h2>数据表占用</h2>
                  <p>包含表数据和聚合后的索引页面。</p>
                </div>
              </div>
              <div className={styles.sizeBars}>
                {diagnostics.storage.tables.slice(0, 10).map((item) => {
                  const maximum = Math.max(
                    ...diagnostics.storage.tables.map((entry) => entry.bytes),
                    1,
                  );
                  return (
                    <div key={item.name}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>{formatBytes(item.bytes)}</small>
                      </span>
                      <i>
                        <b style={{ width: `${(item.bytes / maximum) * 100}%` }} />
                      </i>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {section === "diagnostics" && loading && !diagnostics && (
        <div className={styles.panel}>
          <div className={styles.empty}>
            <LoaderCircle className="spin" size={19} />
            正在读取系统信息…
          </div>
        </div>
      )}

      {section === "recycle" && (
        <section
          className={`${styles.panel} ${
            loading && deletedCases.length ? styles.refreshing : ""
          }`}
          aria-busy={loading}
        >
          <div className={styles.recycleHeading}>
            <div className={styles.panelHeading}>
              <span className={styles.iconOrange}>
                <Trash2 size={19} />
              </span>
              <div>
                <h2>用例回收站</h2>
                <p>恢复误删用例；即使彻底删除，永久修改历史也不会被清除。</p>
              </div>
            </div>
            <form className={styles.search} onSubmit={searchRecycle}>
              <Search size={15} />
              <input
                value={recycleQuery}
                onChange={(event) => setRecycleQuery(event.target.value)}
                placeholder="搜索 CaseID、srNum 或删除人"
                aria-label="搜索回收站"
              />
              <button type="submit">搜索</button>
            </form>
          </div>

          {loading && deletedCases.length === 0 ? (
            <div className={styles.empty}>
              <LoaderCircle className="spin" size={19} />
              正在读取回收站…
            </div>
          ) : deletedCases.length ? (
            <div className={styles.recycleList}>
              {deletedCases.map((item) => (
                <article key={item.id}>
                  <span className={styles.fileIcon}>
                    <Trash2 size={17} />
                  </span>
                  <div className={styles.recycleIdentity}>
                    <strong>{item.caseId}</strong>
                    <small>{item.srNum} · {item.sourceName}</small>
                  </div>
                  <div className={styles.recycleMeta}>
                    <span>{item.deletedByDisplayName || item.deletedByUsername}</span>
                    <small>{localDate(item.deletedAt)}</small>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      className="button button-quiet button-small"
                      type="button"
                      disabled={busy === `recycle-${item.id}`}
                      onClick={() => void restoreCase(item)}
                    >
                      <RotateCcw size={14} />
                      恢复
                    </button>
                    <button
                      className={styles.iconButton}
                      type="button"
                      aria-label={`彻底删除 ${item.caseId}`}
                      disabled={busy === `recycle-${item.id}`}
                      onClick={() =>
                        setConfirmAction({ kind: "purge", item })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              {appliedRecycleQuery ? "没有匹配的已删除用例" : "回收站是空的"}
            </div>
          )}

          <div className={styles.pagination}>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={recycleOffset === 0}
              onClick={() => setRecycleOffset((current) => Math.max(0, current - 30))}
            >
              <ChevronLeft size={14} />
              上一页
            </button>
            <span>第 {Math.floor(recycleOffset / 30) + 1} 页</span>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={!recycleHasMore}
              onClick={() => setRecycleOffset((current) => current + 30)}
            >
              下一页
              <ChevronRight size={14} />
            </button>
          </div>
        </section>
      )}

      {section === "settings" && settingsDraft && (
        <section className={`${styles.panel} ${styles.settingsLayout}`}>
          <div className={styles.panelHeading}>
            <span className={styles.iconOrange}>
              <Settings size={19} />
            </span>
            <div>
              <h2>导入限制</h2>
              <p>控制单次导入可处理的文件数量与大小上限。</p>
            </div>
          </div>
          <form className={styles.form} onSubmit={saveSettings}>
            <label>
              <span>单次最多导入文件数</span>
              <input
                type="number"
                min={1}
                required
                value={settingsDraft.maxImportFiles}
                onChange={(event) =>
                  setSettingsDraft((current) =>
                    current
                      ? { ...current, maxImportFiles: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </label>
            <label>
              <span>单个文件大小上限（MB）</span>
              <input
                type="number"
                min={1}
                max={8192}
                required
                value={settingsDraft.maxImportMb}
                onChange={(event) =>
                  setSettingsDraft((current) =>
                    current
                      ? { ...current, maxImportMb: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </label>
            <label>
              <span>ZIP 解压后表格总大小上限（MB）</span>
              <input
                type="number"
                min={1}
                max={8192}
                required
                value={settingsDraft.maxArchiveUncompressedMb}
                onChange={(event) =>
                  setSettingsDraft((current) =>
                    current
                      ? {
                          ...current,
                          maxArchiveUncompressedMb: Number(event.target.value),
                        }
                      : current,
                  )
                }
              />
            </label>
            <label>
              <span>ZIP 内条目检查上限</span>
              <input
                type="number"
                min={1}
                required
                value={settingsDraft.maxArchiveEntries}
                onChange={(event) =>
                  setSettingsDraft((current) =>
                    current
                      ? {
                          ...current,
                          maxArchiveEntries: Number(event.target.value),
                        }
                      : current,
                  )
                }
              />
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy === "settings-save"}
            >
              {busy === "settings-save" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              保存配置
            </button>
          </form>
        </section>
      )}

      {confirmAction && (
        <div className={styles.confirmBackdrop} role="presentation">
          <div
            className={styles.confirm}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="maintenance-confirm-title"
          >
            <span className={styles.confirmIcon}>
              <CircleAlert size={21} />
            </span>
            <h2 id="maintenance-confirm-title">
              {confirmAction.kind === "backup" ? "删除备份？" : "彻底删除用例？"}
            </h2>
            <p>
              {confirmAction.kind === "backup"
                ? `备份“${confirmAction.item.fileName}”将从本机永久移除。`
                : `“${confirmAction.item.caseId}”将无法再从回收站恢复，但其修改历史仍永久保留。`}
            </p>
            <div>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                className={`button ${styles.dangerButton}`}
                type="button"
                onClick={() =>
                  confirmAction.kind === "backup"
                    ? void deleteBackup(confirmAction.item)
                    : void purgeCase(confirmAction.item)
                }
              >
                <Trash2 size={15} />
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
