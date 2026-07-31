"use client";

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Copy,
  Database,
  Download,
  ExternalLink,
  File,
  FileClock,
  FileSpreadsheet,
  Gauge,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  ListFilter,
  LoaderCircle,
  LogOut,
  Menu,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  ScrollText,
  ScanLine,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  CSSProperties,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Logo } from "@/components/logo";
import {
  AuditLogView,
  LdapSettings,
  UserManagement,
} from "@/components/admin-console";
import { CustomSelect } from "@/components/custom-controls";
import {
  ImportCenter,
  ImportSourceTracker,
} from "@/components/import-center";
import {
  BulkCaseActions,
  CaseManagementTools,
} from "@/components/case-management-tools";
import { MaintenanceCenter } from "@/components/maintenance-center";
import { ProfileSettings } from "@/components/profile-settings";
import type {
  CaseData,
  CaseHistoryItem,
  CaseListItem,
  DashboardStats,
  UserProvider,
  UserRole,
} from "@/lib/types";
import { displayInitial } from "@/lib/display-text";
import {
  groovyClientExample,
  java8ClientExample,
} from "@/lib/api-client-examples";
import {
  getCaseCell,
  getJourneyStepNames,
  getJourneySteps,
  isJourneyCase,
} from "@/lib/case-data";

type WorkspaceView =
  | "cases"
  | "caseSearch"
  | "caseTemplates"
  | "overview"
  | "api"
  | "profile"
  | "users"
  | "ldap"
  | "imports"
  | "backups"
  | "systemInfo"
  | "recycle"
  | "audit";
type GroupItem = { srNum: string; count: number };

const countFormatter = new Intl.NumberFormat("zh-CN");
const SIDEBAR_HIDDEN_STORAGE_KEY = "ddt-insight:sidebar-hidden";
const CASE_LIST_WIDTH_STORAGE_KEY = "ddt-insight:case-list-width";

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatReviewValue(value: unknown) {
  return formatValue(value) || "（空值）";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy unavailable");
}

function timeAgo(value: string) {
  const distance = Date.now() - new Date(value).getTime();
  if (distance < 60_000) return "刚刚";
  if (distance < 3_600_000) return `${Math.floor(distance / 60_000)} 分钟前`;
  if (distance < 86_400_000)
    return `${Math.floor(distance / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

const viewLabels: Record<WorkspaceView, string> = {
  cases: "用例管理",
  caseSearch: "高级检索",
  caseTemplates: "字段模板",
  overview: "数据概览",
  api: "开放 API",
  profile: "个人信息",
  users: "用户管理",
  ldap: "LDAP",
  imports: "导入来源",
  backups: "备份与恢复",
  systemInfo: "系统信息",
  recycle: "回收站",
  audit: "审计日志",
};

export function WorkspaceClient({
  userId,
  username,
  displayName,
  role,
  provider,
}: {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  provider: UserProvider;
}) {
  const router = useRouter();
  const [currentDisplayName, setCurrentDisplayName] = useState(displayName);
  const [view, setView] = useState<WorkspaceView>("cases");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedCase, setSelectedCase] = useState<CaseData | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [toast, setToast] = useState("");
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    setCurrentDisplayName(displayName);
  }, [displayName]);

  useEffect(() => {
    setSidebarHidden(
      window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === "true",
    );
  }, []);

  useEffect(() => {
    const caseId = new URLSearchParams(window.location.search).get("caseId");
    if (caseId) {
      setQuery(caseId);
      setSelectedCaseId(caseId);
    }
    setDeepLinkReady(true);
  }, []);

  useEffect(() => {
    if (!deepLinkReady) return;
    const url = new URL(window.location.href);
    if (view === "cases" && selectedCaseId) {
      url.searchParams.set("caseId", selectedCaseId);
    } else {
      url.searchParams.delete("caseId");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [deepLinkReady, selectedCaseId, view]);

  const handleUnauthorized = useCallback(
    (response: Response) => {
      if (response.status === 401) {
        router.push("/");
        router.refresh();
        return true;
      }
      return false;
    },
    [router],
  );

  const loadGroups = useCallback(async () => {
    const response = await fetch("/api/groups?limit=500", {
      cache: "no-store",
    });
    if (handleUnauthorized(response)) return;
    if (!response.ok) return;
    const body = (await response.json()) as { items: GroupItem[] };
    setGroups(body.items);
  }, [handleUnauthorized]);

  const loadStats = useCallback(async () => {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) return;
    setStats((await response.json()) as DashboardStats);
  }, []);

  const loadCases = useCallback(
    async (reset = true) => {
      const sequence = ++requestSequence.current;
      if (reset) setCasesLoading(true);
      const offset = reset ? 0 : cases.length;
      const parameters = new URLSearchParams({
        query,
        srNum: selectedGroup,
        limit: "60",
        offset: String(offset),
      });

      try {
        const response = await fetch(`/api/cases?${parameters}`, {
          cache: "no-store",
        });
        if (handleUnauthorized(response)) return [];
        if (!response.ok) throw new Error("读取用例失败");
        const body = (await response.json()) as {
          items: CaseListItem[];
          hasMore: boolean;
        };
        if (sequence !== requestSequence.current) return [];

        setCases((current) =>
          reset ? body.items : [...current, ...body.items],
        );
        setHasMore(body.hasMore);

        if (reset) {
          const nextSelected =
            body.items.find((item) => item.caseId === selectedCaseId)?.caseId ??
            body.items[0]?.caseId ??
            "";
          setSelectedCaseId(nextSelected);
          if (!nextSelected) setSelectedCase(null);
        }
        return body.items;
      } catch {
        if (sequence === requestSequence.current) {
          setToast("暂时无法读取用例，请稍后重试");
        }
        return [];
      } finally {
        if (sequence === requestSequence.current) setCasesLoading(false);
      }
    },
    [
      cases.length,
      handleUnauthorized,
      query,
      selectedCaseId,
      selectedGroup,
    ],
  );

  useEffect(() => {
    void loadGroups();
    void loadStats();
  }, [loadGroups, loadStats]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCases(true), 180);
    return () => window.clearTimeout(timer);
    // selectedCaseId is intentionally excluded: selecting an item must not
    // retrigger the list query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedGroup]);

  useEffect(() => {
    if (!selectedCaseId) return;
    let cancelled = false;
    setCaseLoading(true);

    fetch(`/api/case?caseId=${encodeURIComponent(selectedCaseId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("读取用例详情失败");
        return (await response.json()) as CaseData;
      })
      .then((body) => {
        if (!cancelled) setSelectedCase(body);
      })
      .catch(() => {
        if (!cancelled) setToast("读取用例详情失败");
      })
      .finally(() => {
        if (!cancelled) setCaseLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCaseId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([loadGroups(), loadStats()]);
    const loadedCases = await loadCases(true);
    const nextSelectedCaseId =
      loadedCases.find((item) => item.caseId === selectedCaseId)?.caseId ??
      loadedCases[0]?.caseId ??
      "";
    if (nextSelectedCaseId && nextSelectedCaseId === selectedCaseId) {
      const response = await fetch(
        `/api/case?caseId=${encodeURIComponent(nextSelectedCaseId)}`,
        { cache: "no-store" },
      );
      if (response.ok) {
        setSelectedCase((await response.json()) as CaseData);
      }
    }
    setHistoryRevision((current) => current + 1);
  }, [loadCases, loadGroups, loadStats, selectedCaseId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  function selectView(nextView: WorkspaceView) {
    setView(nextView);
    setMobileNavigationOpen(false);
  }

  function setDesktopSidebarHidden(hidden: boolean) {
    setSidebarHidden(hidden);
    window.localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(hidden));
  }

  return (
    <div
      className={classNames(
        "workspace-shell",
        sidebarHidden && "workspace-sidebar-hidden",
      )}
    >
      <aside
        className={classNames(
          "workspace-sidebar",
          mobileNavigationOpen && "workspace-sidebar-open",
        )}
      >
        <div className="sidebar-head">
          <Logo />
          <button
            className="icon-button sidebar-collapse-button"
            type="button"
            aria-label="隐藏主导航"
            title="隐藏主导航"
            onClick={() => setDesktopSidebarHidden(true)}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className="icon-button mobile-nav-close"
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileNavigationOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <nav className="workspace-nav">
          <small>工作区</small>
          <button
            className={classNames(view === "cases" && "active")}
            type="button"
            onClick={() => selectView("cases")}
          >
            <Database size={18} />
            用例管理
            {stats && <em>{countFormatter.format(stats.totalCases)}</em>}
          </button>
          <button
            className={classNames(view === "caseSearch" && "active")}
            type="button"
            onClick={() => selectView("caseSearch")}
          >
            <Search size={18} />
            高级检索
          </button>
          <button
            className={classNames(view === "caseTemplates" && "active")}
            type="button"
            onClick={() => selectView("caseTemplates")}
          >
            <LayoutTemplate size={18} />
            字段模板
          </button>
          <button
            className={classNames(view === "overview" && "active")}
            type="button"
            onClick={() => selectView("overview")}
          >
            <LayoutGrid size={18} />
            数据概览
          </button>
          <small>开发者</small>
          <button
            className={classNames(view === "api" && "active")}
            type="button"
            onClick={() => selectView("api")}
          >
            <Braces size={18} />
            开放 API
            <span className="nav-open-pill">OPEN</span>
          </button>
          <small>账户</small>
          <button
            className={classNames(view === "profile" && "active")}
            type="button"
            onClick={() => selectView("profile")}
          >
            <UserRound size={18} />
            个人信息
          </button>
          {role === "admin" && (
            <>
              <small>系统管理</small>
              <button
                className={classNames(view === "users" && "active")}
                type="button"
                onClick={() => selectView("users")}
              >
                <Users size={18} />
                用户管理
              </button>
              <button
                className={classNames(view === "ldap" && "active")}
                type="button"
                onClick={() => selectView("ldap")}
              >
                <Network size={18} />
                LDAP
              </button>
              <button
                className={classNames(view === "imports" && "active")}
                type="button"
                onClick={() => selectView("imports")}
              >
                <FileClock size={18} />
                导入来源
              </button>
              <button
                className={classNames(view === "backups" && "active")}
                type="button"
                onClick={() => selectView("backups")}
              >
                <Archive size={18} />
                备份与恢复
              </button>
              <button
                className={classNames(view === "systemInfo" && "active")}
                type="button"
                onClick={() => selectView("systemInfo")}
              >
                <Gauge size={18} />
                系统信息
              </button>
              <button
                className={classNames(view === "recycle" && "active")}
                type="button"
                onClick={() => selectView("recycle")}
              >
                <Trash2 size={18} />
                回收站
              </button>
              <button
                className={classNames(view === "audit" && "active")}
                type="button"
                onClick={() => selectView("audit")}
              >
                <ScrollText size={18} />
                审计日志
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-offline-card">
          <span>
            <CloudOff size={17} />
          </span>
          <p>
            <strong>离线模式</strong>
            <small>所有服务均在本机运行</small>
          </p>
          <i />
        </div>

        <div className="sidebar-user">
          <span>{displayInitial(currentDisplayName)}</span>
          <p>
            <strong title={currentDisplayName}>{currentDisplayName}</strong>
            <small>
              {role === "admin" ? "系统管理员" : "用例编辑员"} ·{" "}
              {provider === "ldap" ? "LDAP" : username}
            </small>
          </p>
          <button
            className="icon-button"
            type="button"
            aria-label="退出登录"
            onClick={logout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {mobileNavigationOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <div className="workspace-main">
        <header className="workspace-topbar">
          <button
            className="icon-button sidebar-restore-button"
            type="button"
            aria-label="显示主导航"
            title="显示主导航"
            onClick={() => setDesktopSidebarHidden(false)}
          >
            <PanelLeftOpen size={18} />
          </button>
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label="打开导航"
            onClick={() => setMobileNavigationOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div>
            <span>DDT Insight</span>
            <ChevronRight size={13} />
            <strong>
              {viewLabels[view]}
            </strong>
          </div>
          <button
            className="help-link"
            type="button"
            onClick={() => setView("api")}
          >
            <CircleHelp size={16} />
            接入帮助
          </button>
        </header>

        {view === "cases" && (
          <CaseManager
            cases={cases}
            groups={groups}
            query={query}
            selectedGroup={selectedGroup}
            selectedCaseId={selectedCaseId}
            selectedCase={selectedCase}
            selectedCaseIds={selectedCaseIds}
            casesLoading={casesLoading}
            caseLoading={caseLoading}
            hasMore={hasMore}
            sidebarHidden={sidebarHidden}
            historyRevision={historyRevision}
            onQueryChange={setQuery}
            onGroupChange={setSelectedGroup}
            onCaseSelect={setSelectedCaseId}
            onCaseSelectionChange={(caseId, checked) => {
              setSelectedCaseIds((current) =>
                checked
                  ? current.includes(caseId)
                    ? current
                    : [...current, caseId]
                  : current.filter((item) => item !== caseId),
              );
            }}
            onLoadedSelectionChange={(checked) => {
              const loaded = new Set(cases.map((item) => item.caseId));
              setSelectedCaseIds((current) =>
                checked
                  ? [...new Set([...current, ...loaded])]
                  : current.filter((item) => !loaded.has(item)),
              );
            }}
            onLoadMore={() => loadCases(false)}
            onImport={() => setImportOpen(true)}
            onCaseUpdate={(data) => {
              const nextCaseId = String(
                getCaseCell(data, "CaseID") ?? selectedCaseId,
              );
              const nextSrNum = String(getCaseCell(data, "srNum") ?? "");
              setSelectedCase(data);
              setCases((current) =>
                current.map((item) =>
                  item.caseId.toLocaleLowerCase("en-US") ===
                  selectedCaseId.toLocaleLowerCase("en-US")
                    ? {
                        ...item,
                        caseId: nextCaseId,
                        srNum: nextSrNum,
                        updatedAt: new Date().toISOString(),
                      }
                    : item,
                ),
              );
              if (nextCaseId !== selectedCaseId) {
                if (
                  query &&
                  !nextCaseId
                    .toLocaleLowerCase("en-US")
                    .startsWith(query.toLocaleLowerCase("en-US"))
                ) {
                  setQuery(nextCaseId);
                }
                setSelectedCaseIds((current) =>
                  current.map((item) =>
                    item === selectedCaseId ? nextCaseId : item,
                  ),
                );
                setSelectedCaseId(nextCaseId);
              }
              if (
                selectedGroup &&
                nextSrNum.toLocaleLowerCase("en-US") !==
                  selectedGroup.toLocaleLowerCase("en-US")
              ) {
                setSelectedGroup("");
              }
              setHistoryRevision((current) => current + 1);
            }}
            onCaseDeleted={async (caseId) => {
              setCases((current) =>
                current.filter(
                  (item) =>
                    item.caseId.toLocaleLowerCase("en-US") !==
                    caseId.toLocaleLowerCase("en-US"),
                ),
              );
              setSelectedCase(null);
              setSelectedCaseId("");
              setSelectedCaseIds((current) =>
                current.filter(
                  (item) =>
                    item.toLocaleLowerCase("en-US") !==
                    caseId.toLocaleLowerCase("en-US"),
                ),
              );
              setHistoryRevision((current) => current + 1);
              await Promise.all([loadGroups(), loadStats()]);
              await loadCases(true);
            }}
            onBulkCasesChanged={async () => {
              setHistoryRevision((current) => current + 1);
              await Promise.all([loadGroups(), loadStats()]);
              await loadCases(true);
              if (selectedCaseId) {
                const response = await fetch(
                  `/api/case?caseId=${encodeURIComponent(selectedCaseId)}`,
                  { cache: "no-store" },
                );
                if (response.ok) {
                  setSelectedCase((await response.json()) as CaseData);
                } else {
                  setSelectedCase(null);
                }
              }
            }}
            onBulkSelectionCleared={() => setSelectedCaseIds([])}
            onToast={setToast}
          />
        )}

        {view === "caseSearch" && (
          <CaseManagementTools
            section="search"
            onOpenCase={(caseId) => {
              setSelectedGroup("");
              setQuery(caseId);
              setSelectedCaseId(caseId);
              setView("cases");
            }}
          />
        )}

        {view === "caseTemplates" && (
          <CaseManagementTools
            section="templates"
            initialSrNum={selectedGroup}
          />
        )}

        {view === "overview" && stats && (
          <WorkspaceOverview stats={stats} onImport={() => setImportOpen(true)} />
        )}

        {view === "api" && <ApiGuide />}

        {view === "profile" && (
          <ProfileSettings
            onProfileUpdated={(profile) =>
              setCurrentDisplayName(profile.displayName)
            }
            onToast={setToast}
          />
        )}

        {view === "users" && role === "admin" && (
          <UserManagement currentUserId={userId} onToast={setToast} />
        )}

        {view === "ldap" && role === "admin" && (
          <LdapSettings onToast={setToast} />
        )}

        {view === "imports" && role === "admin" && <ImportSourceTracker />}

        {view === "backups" && role === "admin" && (
          <MaintenanceCenter section="backup" onToast={setToast} />
        )}

        {view === "systemInfo" && role === "admin" && (
          <MaintenanceCenter section="diagnostics" onToast={setToast} />
        )}

        {view === "recycle" && role === "admin" && (
          <MaintenanceCenter
            section="recycle"
            onToast={setToast}
            onCasesChanged={() => {
              setSelectedCase(null);
              setSelectedCaseId("");
              setSelectedCaseIds([]);
              void Promise.all([loadGroups(), loadStats(), loadCases(true)]);
            }}
          />
        )}

        {view === "audit" && role === "admin" && <AuditLogView />}
      </div>

      {importOpen && (
        <ImportCenter
          onClose={() => setImportOpen(false)}
          onImported={refreshAfterImport}
          onToast={setToast}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function CaseManager({
  cases,
  groups,
  query,
  selectedGroup,
  selectedCaseId,
  selectedCase,
  selectedCaseIds,
  casesLoading,
  caseLoading,
  hasMore,
  sidebarHidden,
  historyRevision,
  onQueryChange,
  onGroupChange,
  onCaseSelect,
  onCaseSelectionChange,
  onLoadedSelectionChange,
  onLoadMore,
  onImport,
  onCaseUpdate,
  onCaseDeleted,
  onBulkCasesChanged,
  onBulkSelectionCleared,
  onToast,
}: {
  cases: CaseListItem[];
  groups: GroupItem[];
  query: string;
  selectedGroup: string;
  selectedCaseId: string;
  selectedCase: CaseData | null;
  selectedCaseIds: string[];
  casesLoading: boolean;
  caseLoading: boolean;
  hasMore: boolean;
  sidebarHidden: boolean;
  historyRevision: number;
  onQueryChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onCaseSelect: (value: string) => void;
  onCaseSelectionChange: (caseId: string, checked: boolean) => void;
  onLoadedSelectionChange: (checked: boolean) => void;
  onLoadMore: () => Promise<CaseListItem[]>;
  onImport: () => void;
  onCaseUpdate: (value: CaseData) => void;
  onCaseDeleted: (caseId: string) => Promise<void>;
  onBulkCasesChanged: (result: {
    changed?: number;
    deleted?: number;
    missing?: string[];
  }) => Promise<void>;
  onBulkSelectionCleared: () => void;
  onToast: (message: string) => void;
}) {
  const currentIndex = cases.findIndex((item) => item.caseId === selectedCaseId);
  const currentItem = cases[currentIndex];
  const selectedCaseIdSet = useMemo(
    () => new Set(selectedCaseIds),
    [selectedCaseIds],
  );
  const allLoadedSelected =
    cases.length > 0 &&
    cases.every((item) => selectedCaseIdSet.has(item.caseId));
  const caseListPanelRef = useRef<HTMLElement>(null);
  const resizeStart = useRef({ pointerX: 0, width: 0 });
  const widthRef = useRef(0);
  const [caseListWidth, setCaseListWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeJourneyStep, setActiveJourneyStep] = useState("");
  const [loadingMoreForNavigation, setLoadingMoreForNavigation] =
    useState(false);
  const journeySteps = selectedCase
    ? getJourneySteps(selectedCase)
    : null;
  const journeyStepNames = selectedCase
    ? getJourneyStepNames(selectedCase)
    : [];
  const journeyStepKey = journeyStepNames.join("|");
  const resolvedJourneyStep =
    journeySteps && journeyStepNames.length
      ? journeySteps[activeJourneyStep]
        ? activeJourneyStep
        : journeyStepNames[0]
      : "";
  const visibleCaseData =
    journeySteps && resolvedJourneyStep
      ? journeySteps[resolvedJourneyStep]
      : selectedCase;

  useEffect(() => {
    setActiveJourneyStep(journeyStepNames[0] ?? "");
    // The joined key is stable while the journey structure is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId, journeyStepKey]);

  const defaultCaseListWidth = useCallback(() => {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--case-list-width",
      ),
    );
    return Number.isFinite(value) ? value : 287;
  }, []);

  const widthBounds = useCallback(() => {
    const rootSize =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
      16;
    const availableWidth =
      caseListPanelRef.current?.parentElement?.getBoundingClientRect().width ??
      window.innerWidth;
    const minimum = Math.max(210, rootSize * 11.5);
    const maximum = Math.max(
      minimum,
      Math.min(920, availableWidth - Math.max(460, rootSize * 27)),
    );
    return { minimum, maximum };
  }, []);

  const clampCaseListWidth = useCallback(
    (value: number) => {
      const { minimum, maximum } = widthBounds();
      return Math.round(Math.min(Math.max(value, minimum), maximum));
    },
    [widthBounds],
  );

  const commitCaseListWidth = useCallback(
    (value: number) => {
      const next = clampCaseListWidth(value);
      widthRef.current = next;
      setCaseListWidth(next);
      window.localStorage.setItem(CASE_LIST_WIDTH_STORAGE_KEY, String(next));
    },
    [clampCaseListWidth],
  );

  const fitCaseIds = useCallback(() => {
    const defaultWidth = defaultCaseListWidth();
    const sample = caseListPanelRef.current?.querySelector(
      ".case-list-item strong",
    );
    const context = document.createElement("canvas").getContext("2d");
    if (context && sample) context.font = getComputedStyle(sample).font;
    const longestCaseIdWidth = cases.reduce(
      (longest, item) =>
        Math.max(
          longest,
          context?.measureText(item.caseId).width ?? item.caseId.length * 8,
        ),
      0,
    );
    commitCaseListWidth(
      Math.max(defaultWidth * 1.45, longestCaseIdWidth + 116),
    );
  }, [cases, commitCaseListWidth, defaultCaseListWidth]);

  useEffect(() => {
    const savedWidth = Number(
      window.localStorage.getItem(CASE_LIST_WIDTH_STORAGE_KEY),
    );
    commitCaseListWidth(
      Number.isFinite(savedWidth) && savedWidth > 0
        ? savedWidth
        : defaultCaseListWidth(),
    );
  }, [commitCaseListWidth, defaultCaseListWidth]);

  useEffect(() => {
    const handleWindowResize = () => {
      setCaseListWidth((current) => {
        if (current === null) return current;
        const next = clampCaseListWidth(current);
        widthRef.current = next;
        return next;
      });
    };
    window.addEventListener("resize", handleWindowResize);
    handleWindowResize();
    const sidebarTransitionTimer = window.setTimeout(handleWindowResize, 220);
    return () => {
      window.clearTimeout(sidebarTransitionTimer);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [clampCaseListWidth, sidebarHidden]);

  useEffect(() => {
    if (!resizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const next = clampCaseListWidth(
        resizeStart.current.width +
          event.clientX -
          resizeStart.current.pointerX,
      );
      widthRef.current = next;
      setCaseListWidth(next);
    };
    const finishResize = () => {
      setResizing(false);
      window.localStorage.setItem(
        CASE_LIST_WIDTH_STORAGE_KEY,
        String(widthRef.current),
      );
    };

    document.body.classList.add("case-list-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize, { once: true });
    window.addEventListener("pointercancel", finishResize, { once: true });
    return () => {
      document.body.classList.remove("case-list-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [clampCaseListWidth, resizing]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = caseListPanelRef.current?.querySelector<HTMLElement>(
        ".case-list",
      );
      const active = list?.querySelector<HTMLElement>(
        ".case-list-item.active",
      );
      if (!list || !active) return;

      const listBounds = list.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      if (activeBounds.bottom > listBounds.bottom) {
        list.scrollBy({
          top: activeBounds.bottom - listBounds.bottom + 8,
          behavior: "auto",
        });
      } else if (activeBounds.top < listBounds.top) {
        list.scrollBy({
          top: activeBounds.top - listBounds.top - 8,
          behavior: "auto",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cases.length, selectedCaseId]);

  async function move(direction: -1 | 1) {
    const next = cases[currentIndex + direction];
    if (next) {
      onCaseSelect(next.caseId);
      return;
    }
    if (direction !== 1 || !hasMore || loadingMoreForNavigation) return;

    setLoadingMoreForNavigation(true);
    try {
      const appended = await onLoadMore();
      if (appended[0]) onCaseSelect(appended[0].caseId);
    } finally {
      setLoadingMoreForNavigation(false);
    }
  }

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        deleteOpen ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.matches(
          "input, textarea, button, [contenteditable='true'], [role='combobox']",
        )
      ) {
        return;
      }

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        void move(1);
      } else if (
        event.key === "ArrowUp" ||
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        void move(-1);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function copyCaseLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("caseId", selectedCaseId);
    try {
      await copyText(url.toString());
      onToast("用例链接已复制");
    } catch {
      onToast("无法访问剪贴板，请复制浏览器地址");
    }
  }

  async function removeSelectedCase() {
    if (!selectedCaseId || deleting) return;
    setDeleting(true);

    try {
      const response = await fetch(
        `/api/cases/${encodeURIComponent(selectedCaseId)}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as {
        error?: string;
        caseId?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "删除用例失败");

      const deletedCaseId = body.caseId ?? selectedCaseId;
      setDeleteOpen(false);
      await onCaseDeleted(deletedCaseId);
      onToast(`已将用例“${deletedCaseId}”移入回收站`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "删除用例失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="case-workspace"
      style={
        caseListWidth === null
          ? undefined
          : ({
              "--case-list-current-width": `${caseListWidth}px`,
            } as CSSProperties)
      }
    >
      <section className="case-list-panel" ref={caseListPanelRef}>
        <div className="case-list-heading">
          <div>
            <h1>用例库</h1>
            <span>
              {countFormatter.format(cases.length)} 条已加载
              {selectedCaseIds.length
                ? ` · 已选 ${countFormatter.format(selectedCaseIds.length)} 条`
                : ""}
            </span>
          </div>
          <button
            className="icon-button add-case-button"
            type="button"
            aria-label="导入用例"
            onClick={onImport}
          >
            <Plus size={19} />
          </button>
        </div>

        <div className="case-list-width-toolbar">
          <span>
            <MoveHorizontal size={13} />
            列表宽度
            {caseListWidth !== null && <em>{caseListWidth}px</em>}
          </span>
          <div>
            <button
              type="button"
              title={allLoadedSelected ? "取消选择已加载用例" : "选择已加载用例"}
              aria-label={
                allLoadedSelected ? "取消选择已加载用例" : "选择已加载用例"
              }
              onClick={() => onLoadedSelectionChange(!allLoadedSelected)}
            >
              {allLoadedSelected ? <Check size={14} /> : <ListChecks size={14} />}
            </button>
            <button
              type="button"
              title="紧凑宽度"
              aria-label="使用紧凑的 CaseID 列表宽度"
              onClick={() => commitCaseListWidth(defaultCaseListWidth() * 0.76)}
            >
              <PanelLeftClose size={14} />
            </button>
            <button
              type="button"
              title="恢复默认宽度"
              aria-label="恢复默认的 CaseID 列表宽度"
              onClick={() => commitCaseListWidth(defaultCaseListWidth())}
            >
              <PanelLeftOpen size={14} />
            </button>
            <button
              type="button"
              title="适应最长 CaseID"
              aria-label="自动扩展以预览最长 CaseID"
              onClick={fitCaseIds}
            >
              <ScanLine size={14} />
            </button>
          </div>
        </div>

        <label className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="按 CaseID 前缀搜索"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => onQueryChange("")}
            >
              <X size={15} />
            </button>
          )}
        </label>

        <div className="group-filter">
          <ListFilter size={15} />
          <CustomSelect
            value={selectedGroup}
            ariaLabel="选择 srNum 分组"
            onChange={onGroupChange}
            options={[
              { value: "", label: "全部 srNum 分组" },
              ...groups.map((group) => ({
                value: group.srNum,
                label: `${group.srNum} · ${group.count}`,
              })),
            ]}
          />
        </div>

        <div className="case-list">
          {casesLoading ? (
            Array.from({ length: 7 }).map((_, index) => (
              <div className="case-list-skeleton" key={index}>
                <i />
                <span />
                <span />
              </div>
            ))
          ) : cases.length ? (
            <>
              {cases.map((item) => {
                const checked = selectedCaseIdSet.has(item.caseId);
                return (
                  <div
                    className={classNames(
                      "case-list-row",
                      item.caseId === selectedCaseId && "active",
                    )}
                    key={item.caseId}
                  >
                    <button
                      className={classNames(
                        "case-list-select",
                        checked && "checked",
                      )}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`${checked ? "取消选择" : "选择"} ${item.caseId}`}
                      onClick={() =>
                        onCaseSelectionChange(item.caseId, !checked)
                      }
                    >
                      <span className="custom-checkbox-box">
                        {checked && <Check size={12} strokeWidth={3} />}
                      </span>
                    </button>
                    <button
                      className={classNames(
                        "case-list-item",
                        item.caseId === selectedCaseId && "active",
                      )}
                      type="button"
                      onClick={() => onCaseSelect(item.caseId)}
                    >
                      <span className="case-file-icon">
                        <File size={16} />
                      </span>
                      <p>
                        <strong title={item.caseId}>{item.caseId}</strong>
                        <small>
                          {item.srNum}
                          <i>·</i>
                          {timeAgo(item.updatedAt)}
                          {item.caseKind === "journey" && (
                            <em className="case-kind-badge">用户旅程</em>
                          )}
                        </small>
                      </p>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                );
              })}
              {hasMore && (
                <button
                  className="load-more"
                  type="button"
                  onClick={() => void onLoadMore()}
                >
                  加载更多
                  <ChevronDown size={14} />
                </button>
              )}
            </>
          ) : (
            <div className="case-list-empty">
              <span>
                <Search size={20} />
              </span>
              <strong>{query || selectedGroup ? "没有匹配用例" : "暂无用例"}</strong>
              <p>
                {query || selectedGroup
                  ? "尝试更换搜索条件"
                  : "导入表格以开始管理"}
              </p>
            </div>
          )}
        </div>
        <div
          className={classNames(
            "case-list-resizer",
            resizing && "active",
          )}
          role="separator"
          aria-label="调整 CaseID 列表宽度"
          aria-orientation="vertical"
          aria-valuenow={caseListWidth ?? undefined}
          tabIndex={0}
          title="拖动调整列表宽度，双击适应最长 CaseID"
          onDoubleClick={fitCaseIds}
          onPointerDown={(event) => {
            resizeStart.current = {
              pointerX: event.clientX,
              width:
                caseListWidth ??
                caseListPanelRef.current?.getBoundingClientRect().width ??
                defaultCaseListWidth(),
            };
            widthRef.current = resizeStart.current.width;
            setResizing(true);
            event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              commitCaseListWidth(
                (caseListWidth ?? defaultCaseListWidth()) +
                  (event.key === "ArrowLeft" ? -24 : 24),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              commitCaseListWidth(defaultCaseListWidth() * 0.76);
            } else if (event.key === "End") {
              event.preventDefault();
              fitCaseIds();
            }
          }}
        >
          <i />
        </div>
      </section>

      <section className="case-detail-panel">
        {selectedCaseIds.length > 0 ? (
          <>
            <div className="detail-toolbar case-bulk-toolbar">
              <div className="case-breadcrumb">
                <span>用例管理</span>
                <ChevronRight size={13} />
                <strong>
                  已选择 {countFormatter.format(selectedCaseIds.length)} 条
                </strong>
              </div>
              <button
                className="button button-quiet button-small"
                type="button"
                onClick={onBulkSelectionCleared}
              >
                <X size={15} />
                清空选择
              </button>
            </div>
            <div className="case-detail-scroll case-bulk-scroll">
              <div className="case-bulk-context">
                <span className="case-bulk-icon">
                  <ListChecks size={21} />
                </span>
                <div>
                  <span className="eyebrow">SELECTION MODE</span>
                  <h2>直接管理所选用例</h2>
                  <p>
                    当前选择保留在左侧列表中，无需切换页面即可修改、导出或移入回收站。
                  </p>
                </div>
              </div>
              <div className="case-bulk-actions">
                <BulkCaseActions
                  selectedCaseIds={selectedCaseIds}
                  onCasesChanged={onBulkCasesChanged}
                  onSelectionCleared={onBulkSelectionCleared}
                />
              </div>
            </div>
          </>
        ) : selectedCase && currentItem ? (
          <>
            <div className="detail-toolbar">
              <div className="case-breadcrumb">
                <span>用例详情</span>
                <ChevronRight size={13} />
                <strong>{selectedCaseId}</strong>
              </div>
              <div className="detail-actions">
                <button
                  className="button button-quiet button-small"
                  type="button"
                  title="复制当前用例深链接"
                  onClick={() => void copyCaseLink()}
                >
                  <Copy size={15} />
                  复制链接
                </button>
                <button
                  className="button button-quiet button-small"
                  type="button"
                  disabled={currentIndex <= 0}
                  onClick={() => void move(-1)}
                >
                  <ChevronLeft size={16} />
                  上一条
                </button>
                <button
                  className="button button-quiet button-small"
                  type="button"
                  disabled={
                    loadingMoreForNavigation ||
                    (currentIndex >= cases.length - 1 && !hasMore)
                  }
                  onClick={() => void move(1)}
                >
                  {loadingMoreForNavigation ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <>
                      下一条
                      <ChevronRight size={16} />
                    </>
                  )}
                </button>
                <span className="toolbar-divider" />
                <button
                  className="button button-danger button-small"
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={15} />
                  删除
                </button>
                <a
                  className="button button-dark button-small"
                  href={`/api/export?caseId=${encodeURIComponent(selectedCaseId)}`}
                >
                  <Download size={15} />
                  导出当前
                </a>
              </div>
            </div>

            <div className="case-detail-scroll">
              <div className="case-title-block">
                <div>
                  <span className="case-title-icon">
                    <FileSpreadsheet size={22} />
                  </span>
                  <div>
                    <span className="eyebrow">CASE RECORD</span>
                    <h2>{selectedCaseId}</h2>
                    <p>
                      来自 {currentItem.sourceName} · {currentItem.srNum}
                    </p>
                  </div>
                </div>
                <div className="case-statuses">
                  {isJourneyCase(selectedCase) && (
                    <span className="case-kind-status">用户旅程</span>
                  )}
                  <span className="case-status">
                    <i />
                    数据有效
                  </span>
                </div>
              </div>

              <div className="detail-summary">
                <div>
                  <small>CaseID</small>
                  <strong>{selectedCaseId}</strong>
                </div>
                <div>
                  <small>所属 srNum</small>
                  <strong>
                    {formatValue(getCaseCell(selectedCase, "srNum"))}
                  </strong>
                </div>
                <div>
                  <small>
                    {journeySteps ? "旅程结构" : "字段数量"}
                  </small>
                  <strong>
                    {journeySteps
                      ? `${journeyStepNames.length} 步 · ${Object.keys(visibleCaseData ?? {}).length} 字段`
                      : Object.keys(visibleCaseData ?? {}).length}
                  </strong>
                </div>
                <div>
                  <small>最后更新</small>
                  <strong>{timeAgo(currentItem.updatedAt)}</strong>
                </div>
              </div>

              {journeySteps && (
                <div className="journey-step-switcher">
                  <div>
                    <span className="eyebrow">USER JOURNEY</span>
                    <strong>切换旅程 Step</strong>
                  </div>
                  <div
                    className="journey-step-tabs"
                    role="tablist"
                    aria-label="用户旅程步骤"
                  >
                    {journeyStepNames.map((stepName, index) => (
                      <button
                        className={classNames(
                          resolvedJourneyStep === stepName && "active",
                        )}
                        key={stepName}
                        type="button"
                        role="tab"
                        aria-selected={resolvedJourneyStep === stepName}
                        onClick={() => setActiveJourneyStep(stepName)}
                      >
                        <span>{index + 1}</span>
                        {stepName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="fields-heading">
                <div>
                  <h3>
                    {journeySteps
                      ? `${resolvedJourneyStep} 字段内容`
                      : "字段内容"}
                  </h3>
                  <p>
                    {journeySteps
                      ? "当前仅展示所选 Step，修改 CaseID 或 srNum 会同步全部 Step"
                      : "逐项查看和修改当前用例的数据"}
                  </p>
                </div>
                <span>
                  <Pencil size={11} />
                  {Object.keys(visibleCaseData ?? {}).length} 个字段 ·
                  悬浮字段可编辑
                </span>
              </div>

              <div
                className={classNames(
                  "case-fields",
                  caseLoading && "case-fields-loading",
                )}
              >
                {Object.entries(visibleCaseData ?? {}).map(([column, value]) => (
                  <EditableField
                    key={`${resolvedJourneyStep}:${column}`}
                    caseId={selectedCaseId}
                    column={column}
                    value={value}
                    stepName={resolvedJourneyStep || undefined}
                    onUpdated={(data) => {
                      onCaseUpdate(data);
                      onToast(
                        `“${resolvedJourneyStep ? `${resolvedJourneyStep} · ` : ""}${column}”已保存`,
                      );
                    }}
                    onError={onToast}
                  />
                ))}
              </div>

              <CaseHistoryPanel
                caseId={selectedCaseId}
                revision={historyRevision}
                onError={onToast}
                onRestored={(data) => {
                  onCaseUpdate(data);
                  onToast("已恢复到所选变更发生前");
                }}
              />
            </div>
          </>
        ) : casesLoading || caseLoading ? (
          <div className="detail-loading">
            <span>
              <RefreshCw size={24} />
            </span>
            <p>正在读取用例…</p>
          </div>
        ) : (
          <div className="empty-detail">
            <span>
              <FileSpreadsheet size={30} />
            </span>
            <h2>从导入第一份表格开始</h2>
            <p>
              系统会读取 data Sheet，或将 step1 至 stepN
              组合为用户旅程，并以 CaseID 建立高性能索引。
            </p>
            <button
              className="button button-primary"
              type="button"
              onClick={onImport}
            >
              <UploadCloud size={17} />
              导入用例表格
            </button>
          </div>
        )}
      </section>

      {deleteOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              !deleting &&
              event.currentTarget === event.target
            ) {
              setDeleteOpen(false);
            }
          }}
        >
          <section
            className="case-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-delete-title"
          >
            <span className="case-delete-icon">
              <Trash2 size={22} />
            </span>
            <h2 id="case-delete-title">删除这条用例？</h2>
            <p>
              用例 <strong>{selectedCaseId}</strong> 将移入回收站，
              管理员可以恢复。既有修改历史会永久保留，本次操作会写入安全审计日志。
            </p>
            <div>
              <button
                className="button button-quiet"
                type="button"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={deleting}
                onClick={() => void removeSelectedCase()}
              >
                {deleting ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                {deleting ? "正在处理" : "移入回收站"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function historyValue(value: unknown, exists: boolean) {
  if (!exists) return "（字段不存在）";
  if (value === null) return "null";
  if (value === "") return "（空字符串）";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function historyDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function CaseHistoryPanel({
  caseId,
  revision,
  onError,
  onRestored,
}: {
  caseId: string;
  revision: number;
  onError: (message: string) => void;
  onRestored: (data: CaseData) => void;
}) {
  const [items, setItems] = useState<CaseHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [restoreCandidate, setRestoreCandidate] =
    useState<CaseHistoryItem | null>(null);
  const [restoring, setRestoring] = useState(false);
  const requestId = useRef(0);

  const loadPage = useCallback(
    async (beforeId: number | null, replace: boolean) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      const parameters = new URLSearchParams({ limit: "15" });
      if (beforeId) parameters.set("beforeId", String(beforeId));

      try {
        const response = await fetch(
          `/api/cases/${encodeURIComponent(caseId)}/history?${parameters}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as {
          items?: CaseHistoryItem[];
          hasMore?: boolean;
          nextCursor?: number | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "读取修改历史失败");
        }
        if (currentRequest !== requestId.current) return;

        const nextItems = body.items ?? [];
        setItems((current) =>
          replace ? nextItems : [...current, ...nextItems],
        );
        setHasMore(Boolean(body.hasMore));
        setNextCursor(body.nextCursor ?? null);
      } catch (error) {
        if (currentRequest === requestId.current) {
          onError(
            error instanceof Error ? error.message : "读取修改历史失败",
          );
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [caseId, onError],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    setExpanded(new Set());
    void loadPage(null, true);
    return () => {
      requestId.current += 1;
    };
  }, [caseId, loadPage, revision]);

  async function restoreVersion(item: CaseHistoryItem) {
    setRestoring(true);
    try {
      const response = await fetch(
        `/api/cases/${encodeURIComponent(caseId)}/history/${item.id}/restore`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        data?: CaseData;
        error?: string;
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error ?? "历史版本回滚失败");
      }
      setRestoreCandidate(null);
      onRestored(body.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : "历史版本回滚失败");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="case-history-panel">
      <div className="case-history-heading">
        <div>
          <span className="case-history-icon">
            <FileClock size={18} />
          </span>
          <div>
            <h3>修改历史</h3>
            <p>独立于审计日志永久保存，按时间倒序分页加载</p>
          </div>
        </div>
        <span>{items.length ? `已加载 ${items.length} 条` : "版本时间线"}</span>
      </div>

      {loading && !items.length ? (
        <div className="case-history-state">
          <LoaderCircle className="spin" size={19} />
          正在读取历史…
        </div>
      ) : items.length ? (
        <div className="case-history-timeline">
          {items.map((item) => {
            const visibleChanges = expanded.has(item.id)
              ? item.changes
              : item.changes.slice(0, 6);
            const actor =
              item.actorDisplayName || item.actorUsername || "未知用户";

            return (
              <article className="case-history-entry" key={item.id}>
                <i className="case-history-dot" />
                <div className="case-history-card">
                  <div className="case-history-meta">
                    <div>
                      <strong>
                        {item.changeType === "edit"
                          ? "手工修改"
                          : "导入覆盖"}
                      </strong>
                      <span>{item.changes.length} 个字段发生变动</span>
                    </div>
                    <time dateTime={item.createdAt}>
                      {historyDate(item.createdAt)}
                    </time>
                    <button
                      className="case-history-restore"
                      type="button"
                      title={`恢复到变更 #${item.id} 发生前`}
                      onClick={() => setRestoreCandidate(item)}
                    >
                      <RotateCcw size={13} />
                      恢复至修改前
                    </button>
                  </div>

                  <div className="case-history-actor">
                    <span>
                      <UserRound size={13} />
                      {actor}
                      {item.actorUsername &&
                        item.actorUsername !== item.actorDisplayName && (
                          <small>@{item.actorUsername}</small>
                        )}
                    </span>
                    <span>
                      {item.actorProvider === "ldap" ? "LDAP" : "本地账户"}
                    </span>
                    {item.sourceName && <span>{item.sourceName}</span>}
                    <span title={item.caseId}>CaseID: {item.caseId}</span>
                  </div>

                  {visibleChanges.length ? (
                    <div className="case-history-changes">
                      {visibleChanges.map((change) => (
                        <div
                          className="case-history-change"
                          key={change.column}
                        >
                          <strong>{change.column}</strong>
                          <span
                            className={!change.beforeExists ? "missing" : ""}
                            title={historyValue(
                              change.before,
                              change.beforeExists,
                            )}
                          >
                            {historyValue(
                              change.before,
                              change.beforeExists,
                            )}
                          </span>
                          <ArrowRight size={13} />
                          <span
                            className={!change.afterExists ? "missing" : ""}
                            title={historyValue(
                              change.after,
                              change.afterExists,
                            )}
                          >
                            {historyValue(
                              change.after,
                              change.afterExists,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="case-history-no-change">
                      本次覆盖的数据内容与上一版本一致。
                    </p>
                  )}

                  {item.changes.length > 6 && (
                    <button
                      className="case-history-expand"
                      type="button"
                      aria-expanded={expanded.has(item.id)}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    >
                      {expanded.has(item.id)
                        ? "收起变动"
                        : `展开其余 ${item.changes.length - 6} 项`}
                      <ChevronDown size={13} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="case-history-state">
          <FileClock size={19} />
          当前用例还没有修改或覆盖记录
        </div>
      )}

      {hasMore && (
        <button
          className="button button-quiet case-history-more"
          type="button"
          disabled={loading || !nextCursor}
          onClick={() => void loadPage(nextCursor, false)}
        >
          {loading ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
          加载更早记录
        </button>
      )}

      {restoreCandidate && (
        <div className="modal-backdrop">
          <section
            className="case-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="history-restore-title"
          >
            <span className="case-delete-icon">
              <RotateCcw size={22} />
            </span>
            <h2 id="history-restore-title">恢复到这次修改之前？</h2>
            <p>
              将把当前用例恢复为变更 #{restoreCandidate.id} 发生前的完整字段内容。
              当前内容会先作为一条新的永久历史保存，因此仍可再次回滚。
            </p>
            <div>
              <button
                className="button button-quiet"
                type="button"
                disabled={restoring}
                onClick={() => setRestoreCandidate(null)}
              >
                取消
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={restoring}
                onClick={() => void restoreVersion(restoreCandidate)}
              >
                {restoring ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
                {restoring ? "正在回滚" : "确认回滚"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function EditableField({
  caseId,
  column,
  value,
  stepName,
  onUpdated,
  onError,
}: {
  caseId: string;
  column: string;
  value: unknown;
  stepName?: string;
  onUpdated: (data: CaseData) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatValue(value));
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const multiline = formatValue(value).length > 90 || /step|desc|expected/i.test(column);

  useEffect(() => {
    setDraft(formatValue(value));
  }, [value]);

  useEffect(() => {
    if (!confirming) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    const focusTimer = window.setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 0);

    function handleDialogKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setConfirming(false);
      }
    }

    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleDialogKeyDown);
      document.body.classList.remove("modal-open");
      previousFocus?.focus();
    };
  }, [confirming, saving]);

  function reviewChange() {
    if (draft === formatValue(value)) {
      setEditing(false);
      return;
    }
    setConfirming(true);
  }

  async function save() {
    setSaving(true);

    try {
      const response = await fetch(
        `/api/cases/${encodeURIComponent(caseId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column, value: draft, step: stepName }),
        },
      );
      const body = (await response.json()) as CaseData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      onUpdated(body);
      setConfirming(false);
      setEditing(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      reviewChange();
    }
    if (event.key === "Escape") {
      setDraft(formatValue(value));
      setEditing(false);
    }
  }

  return (
    <article
      className={classNames(
        "field-card",
        multiline && "field-wide",
        editing && "editing",
      )}
    >
      <div className="field-label">
        <span>{column}</span>
        {column === "CaseID" && <em>唯一索引 · 修改时校验</em>}
      </div>

      {editing ? (
        <div className="field-editor">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
              rows={4}
            />
          ) : (
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          )}
          <div>
            <button
              className="button button-quiet button-small"
              type="button"
              onClick={() => {
                setDraft(formatValue(value));
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              className="button button-primary button-small"
              type="button"
              disabled={saving}
              onClick={reviewChange}
            >
              <Save size={14} />
              审阅修改
            </button>
          </div>
        </div>
      ) : (
        <div className="field-value">
          <p className={!formatValue(value) ? "empty-value" : ""}>
            {formatValue(value) || "空值"}
          </p>
          <button
            className="field-edit-button"
            type="button"
            aria-label={`复制 ${column}`}
            onClick={async () => {
              try {
                await copyText(formatValue(value));
                onError(`“${column}”已复制`);
              } catch {
                onError("无法访问剪贴板");
              }
            }}
          >
            <Copy size={14} />
            复制
          </button>
          <button
            className="field-edit-button"
            type="button"
            aria-label={`编辑 ${column}`}
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            编辑
          </button>
        </div>
      )}

      {confirming && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (!saving && event.currentTarget === event.target) {
              setConfirming(false);
            }
          }}
        >
          <section
            className="case-update-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="case-update-title"
            aria-describedby="case-update-description"
          >
            <span className="case-update-icon">
              <Pencil size={21} />
            </span>
            <h2 id="case-update-title">确认提交这次修改？</h2>
            <p id="case-update-description">
              请再次核对修改前后的内容。确认后将立即更新用例，并永久记录修改人和变动详情。
            </p>

            <dl className="case-update-meta">
              <div>
                <dt>CaseID</dt>
                <dd>{caseId}</dd>
              </div>
              <div>
                <dt>修改字段</dt>
                <dd>{stepName ? `${stepName} · ${column}` : column}</dd>
              </div>
            </dl>

            <div className="case-update-comparison">
              <div>
                <span>修改前</span>
                <p>{formatReviewValue(value)}</p>
              </div>
              <div>
                <span>修改后</span>
                <p>{formatReviewValue(draft)}</p>
              </div>
            </div>

            <div className="case-update-actions">
              <button
                className="button button-quiet"
                type="button"
                disabled={saving}
                onClick={() => setConfirming(false)}
              >
                返回修改
              </button>
              <button
                ref={confirmButtonRef}
                className="button button-primary"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                {saving ? "正在提交" : "确认提交"}
              </button>
            </div>
          </section>
        </div>
      )}
    </article>
  );
}

function WorkspaceOverview({
  stats,
  onImport,
}: {
  stats: DashboardStats;
  onImport: () => void;
}) {
  const maxTimeline = Math.max(...stats.timeline.map((item) => item.count), 1);
  const maxGroup = Math.max(...stats.groups.map((item) => item.count), 1);

  return (
    <div className="workspace-page">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">实时数据</span>
          <h1>数据概览</h1>
          <p>掌握平台中的用例规模、分组和导入活动。</p>
        </div>
        <div>
          <a className="button button-quiet" href="/api/export">
            <Download size={16} />
            导出全部
          </a>
          <button className="button button-primary" type="button" onClick={onImport}>
            <Plus size={16} />
            导入表格
          </button>
        </div>
      </div>

      <div className="workspace-stat-grid">
        <article>
          <span className="workspace-stat-icon blue">
            <Database size={19} />
          </span>
          <div>
            <small>用例总数</small>
            <strong>{countFormatter.format(stats.totalCases)}</strong>
          </div>
          <em>
            <Zap size={12} /> 已索引
          </em>
        </article>
        <article>
          <span className="workspace-stat-icon purple">
            <LayoutGrid size={19} />
          </span>
          <div>
            <small>srNum 分组</small>
            <strong>{countFormatter.format(stats.totalGroups)}</strong>
          </div>
        </article>
        <article>
          <span className="workspace-stat-icon green">
            <FileSpreadsheet size={19} />
          </span>
          <div>
            <small>导入批次</small>
            <strong>{countFormatter.format(stats.totalFiles)}</strong>
          </div>
          <em>{stats.importedToday} 今日</em>
        </article>
        <article>
          <span className="workspace-stat-icon orange">
            <Sparkles size={19} />
          </span>
          <div>
            <small>今日活跃</small>
            <strong>{countFormatter.format(stats.updatedToday)}</strong>
          </div>
        </article>
      </div>

      <div className="workspace-analytics">
        <article className="workspace-panel workspace-trend">
          <div className="workspace-panel-heading">
            <div>
              <h2>导入趋势</h2>
              <p>近 7 日写入用例数量</p>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="workspace-bars">
            {stats.timeline.map((item) => (
              <div key={item.date}>
                <span>
                  <i
                    style={{
                      height: `${Math.max(
                        (item.count / maxTimeline) * 100,
                        3,
                      )}%`,
                    }}
                  >
                    {item.count > 0 && <em>{item.count}</em>}
                  </i>
                </span>
                <small>{item.date.slice(5).replace("-", "/")}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="workspace-panel">
          <div className="workspace-panel-heading">
            <div>
              <h2>用例组分布</h2>
              <p>数量最多的 6 个 srNum</p>
            </div>
            <LayoutGrid size={18} />
          </div>
          <div className="workspace-group-list">
            {stats.groups.length ? (
              stats.groups.map((group, index) => (
                <div key={group.srNum}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>
                    <strong>{group.srNum}</strong>
                    <i>
                      <em
                        style={{
                          width: `${Math.max(
                            (group.count / maxGroup) * 100,
                            4,
                          )}%`,
                        }}
                      />
                    </i>
                  </p>
                  <b>{countFormatter.format(group.count)}</b>
                </div>
              ))
            ) : (
              <div className="workspace-panel-empty">
                <Database size={24} />
                <p>暂无分组数据</p>
              </div>
            )}
          </div>
        </article>
      </div>

      <article className="workspace-panel imports-table-card">
        <div className="workspace-panel-heading">
          <div>
            <h2>最近导入</h2>
            <p>最新的表格数据写入记录</p>
          </div>
          <span className="live-label">
            <i /> 本机数据库
          </span>
        </div>
        <div className="imports-table">
          <div className="imports-table-head">
            <span>文件名称</span>
            <span>用例行数</span>
            <span>导入时间</span>
            <span>状态</span>
          </div>
          {stats.recentImports.length ? (
            stats.recentImports.map((item) => (
              <div className="imports-table-row" key={item.id}>
                <span>
                  <i>
                    <FileSpreadsheet size={16} />
                  </i>
                  <strong>{item.fileName}</strong>
                </span>
                <span>{countFormatter.format(item.rowCount)} 条</span>
                <span>{new Date(item.importedAt).toLocaleString("zh-CN")}</span>
                <span>
                  <em>
                    <Check size={12} /> 已完成
                  </em>
                </span>
              </div>
            ))
          ) : (
            <div className="table-empty">尚无导入记录</div>
          )}
        </div>
      </article>
    </div>
  );
}

function ApiGuide() {
  const [copied, setCopied] = useState("");
  const apiPath = "/api/case?caseId=CASE-001";
  const absoluteApi =
    typeof window === "undefined"
      ? apiPath
      : `${window.location.origin}${apiPath}`;

  function copy(value: string, label: string) {
    void copyText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    });
  }

  return (
    <div className="workspace-page api-guide">
      <div className="workspace-page-heading">
        <div>
          <span className="eyebrow">DEVELOPER API</span>
          <h1>开放 API</h1>
          <p>通过 CaseID 读取完整用例，无需鉴权或令牌。</p>
        </div>
        <a
          className="button button-quiet"
          href="/api/health"
          target="_blank"
          rel="noreferrer"
        >
          服务健康检查
          <ExternalLink size={15} />
        </a>
      </div>

      <div className="api-status-strip">
        <span className="api-status-icon">
          <Server size={20} />
        </span>
        <div>
          <strong>API 服务运行正常</strong>
          <p>本机服务 · 无鉴权 · CORS 已开放</p>
        </div>
        <em>
          <i /> OPERATIONAL
        </em>
      </div>

      <div className="api-doc-grid">
        <div className="api-doc-main">
          <article className="api-doc-card">
            <div className="api-doc-card-heading">
              <span className="method-get">GET</span>
              <div>
                <h2>按 CaseID 查询用例</h2>
                <p>返回该用例所有列名和值组成的 JSON 对象。</p>
              </div>
            </div>
            <div className="endpoint-box">
              <code>{absoluteApi}</code>
              <button
                type="button"
                onClick={() => copy(absoluteApi, "endpoint")}
              >
                {copied === "endpoint" ? <Check size={15} /> : "复制"}
              </button>
            </div>
            <div className="parameter-table">
              <div>
                <span>参数</span>
                <span>类型</span>
                <span>必填</span>
                <span>说明</span>
              </div>
              <div>
                <code>caseId</code>
                <span>string</span>
                <em>是</em>
                <span>用例的唯一 CaseID</span>
              </div>
            </div>
          </article>

          <article className="api-doc-card">
            <div className="api-doc-section-heading">
              <div>
                <h2>响应示例</h2>
                <p>HTTP 200 · application/json</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  copy(
                    `{\n  "CaseID": "CASE-001",\n  "srNum": "SR-2026-008",\n  "Title": "验证用户登录",\n  "Priority": "P0",\n  "Expected": "登录成功"\n}`,
                    "json",
                  )
                }
              >
                {copied === "json" ? <Check size={14} /> : "复制 JSON"}
              </button>
            </div>
            <pre className="api-json">
              <code>
                <span>{"{"}</span>
                {`\n  `}
                <i>&quot;CaseID&quot;</i>: <b>&quot;CASE-001&quot;</b>,
                {`\n  `}
                <i>&quot;srNum&quot;</i>: <b>&quot;SR-2026-008&quot;</b>,
                {`\n  `}
                <i>&quot;Title&quot;</i>: <b>&quot;验证用户登录&quot;</b>,
                {`\n  `}
                <i>&quot;Priority&quot;</i>: <b>&quot;P0&quot;</b>,
                {`\n  `}
                <i>&quot;Expected&quot;</i>: <b>&quot;登录成功&quot;</b>
                {`\n`}
                <span>{"}"}</span>
              </code>
            </pre>
            <p className="api-journey-note">
              <strong>用户旅程：</strong>
              返回对象会额外包含“用户旅程” Map，内部按
              <code>step1</code> 至 <code>stepN</code>
              保存各 Step 的完整列名和值。
            </p>
          </article>

          <section className="api-client-examples">
            <div className="api-client-examples-heading">
              <span className="eyebrow">COPY-READY CLIENTS</span>
              <h2>调用工具类</h2>
              <p>
                传入实例地址和 CaseID，成功时返回字段 Map；未查到时返回 null。
              </p>
            </div>

            <article className="api-code-card">
              <div className="api-code-card-heading">
                <div>
                  <span className="api-language-badge java">JDK 8</span>
                  <div>
                    <h3>Java 8 标准库客户端</h3>
                    <p>不依赖 Jackson、Gson 或其他第三方包。</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(java8ClientExample, "java8")}
                >
                  {copied === "java8" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "java8" ? "已复制" : "复制代码"}
                </button>
              </div>
              <pre className="api-client-code">
                <code>{java8ClientExample}</code>
              </pre>
            </article>

            <article className="api-code-card">
              <div className="api-code-card-heading">
                <div>
                  <span className="api-language-badge groovy">Groovy</span>
                  <div>
                    <h3>Groovy 调用客户端</h3>
                    <p>适用于 Groovy 2.4+，使用内置 JsonSlurper。</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(groovyClientExample, "groovy")}
                >
                  {copied === "groovy" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "groovy" ? "已复制" : "复制代码"}
                </button>
              </div>
              <pre className="api-client-code">
                <code>{groovyClientExample}</code>
              </pre>
            </article>
          </section>
        </div>

        <aside className="api-doc-aside">
          <article>
            <span className="aside-icon green">
              <ShieldCheck size={20} />
            </span>
            <h3>无需鉴权</h3>
            <p>内网调用不需要 API Key、Token 或登录 Cookie。</p>
          </article>
          <article>
            <span className="aside-icon blue">
              <Gauge size={20} />
            </span>
            <h3>性能响应头</h3>
            <p>
              每次响应包含 <code>X-Response-Time</code>，便于观测接口耗时。
            </p>
          </article>
          <article>
            <span className="aside-icon purple">
              <Braces size={20} />
            </span>
            <h3>REST 路径形式</h3>
            <p>也可以使用以下等价路径：</p>
            <code className="aside-code">/api/cases/CASE-001</code>
          </article>
        </aside>
      </div>
    </div>
  );
}
