"use client";

import {
  ArrowDownToLine,
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
  Database,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileSpreadsheet,
  Gauge,
  LayoutGrid,
  ListFilter,
  LogOut,
  Menu,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  ScrollText,
  ScanLine,
  Sparkles,
  UploadCloud,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
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
import type {
  CaseData,
  CaseListItem,
  DashboardStats,
  ImportResult,
  UserProvider,
  UserRole,
} from "@/lib/types";

type WorkspaceView =
  | "cases"
  | "overview"
  | "api"
  | "users"
  | "ldap"
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
  overview: "数据概览",
  api: "开放 API",
  users: "用户管理",
  ldap: "LDAP",
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
  const [view, setView] = useState<WorkspaceView>("cases");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedCase, setSelectedCase] = useState<CaseData | null>(null);
  const [casesLoading, setCasesLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [toast, setToast] = useState("");
  const requestSequence = useRef(0);

  useEffect(() => {
    setSidebarHidden(
      window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === "true",
    );
  }, []);

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
        if (handleUnauthorized(response)) return;
        if (!response.ok) throw new Error("读取用例失败");
        const body = (await response.json()) as {
          items: CaseListItem[];
          hasMore: boolean;
        };
        if (sequence !== requestSequence.current) return;

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
      } catch {
        if (sequence === requestSequence.current) {
          setToast("暂时无法读取用例，请稍后重试");
        }
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
    await loadCases(true);
  }, [loadCases, loadGroups, loadStats]);

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
          <span>{displayName.slice(0, 1).toUpperCase()}</span>
          <p>
            <strong>{displayName}</strong>
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
            casesLoading={casesLoading}
            caseLoading={caseLoading}
            hasMore={hasMore}
            sidebarHidden={sidebarHidden}
            onQueryChange={setQuery}
            onGroupChange={setSelectedGroup}
            onCaseSelect={setSelectedCaseId}
            onLoadMore={() => void loadCases(false)}
            onImport={() => setImportOpen(true)}
            onCaseUpdate={(data) => {
              const nextCaseId = String(data.CaseID ?? selectedCaseId);
              const nextSrNum = String(data.srNum ?? "");
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
                setSelectedCaseId(nextCaseId);
              }
            }}
            onToast={setToast}
          />
        )}

        {view === "overview" && stats && (
          <WorkspaceOverview stats={stats} onImport={() => setImportOpen(true)} />
        )}

        {view === "api" && <ApiGuide />}

        {view === "users" && role === "admin" && (
          <UserManagement currentUserId={userId} onToast={setToast} />
        )}

        {view === "ldap" && role === "admin" && (
          <LdapSettings onToast={setToast} />
        )}

        {view === "audit" && role === "admin" && <AuditLogView />}
      </div>

      {importOpen && (
        <ImportModal
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
  casesLoading,
  caseLoading,
  hasMore,
  sidebarHidden,
  onQueryChange,
  onGroupChange,
  onCaseSelect,
  onLoadMore,
  onImport,
  onCaseUpdate,
  onToast,
}: {
  cases: CaseListItem[];
  groups: GroupItem[];
  query: string;
  selectedGroup: string;
  selectedCaseId: string;
  selectedCase: CaseData | null;
  casesLoading: boolean;
  caseLoading: boolean;
  hasMore: boolean;
  sidebarHidden: boolean;
  onQueryChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onCaseSelect: (value: string) => void;
  onLoadMore: () => void;
  onImport: () => void;
  onCaseUpdate: (value: CaseData) => void;
  onToast: (message: string) => void;
}) {
  const currentIndex = cases.findIndex((item) => item.caseId === selectedCaseId);
  const currentItem = cases[currentIndex];
  const caseListPanelRef = useRef<HTMLElement>(null);
  const resizeStart = useRef({ pointerX: 0, width: 0 });
  const widthRef = useRef(0);
  const [caseListWidth, setCaseListWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

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

  function move(direction: -1 | 1) {
    const next = cases[currentIndex + direction];
    if (next) onCaseSelect(next.caseId);
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
            <span>{countFormatter.format(cases.length)} 条已加载</span>
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

        <label className="group-filter">
          <ListFilter size={15} />
          <select
            value={selectedGroup}
            onChange={(event) => onGroupChange(event.target.value)}
          >
            <option value="">全部 srNum 分组</option>
            {groups.map((group) => (
              <option key={group.srNum} value={group.srNum}>
                {group.srNum} · {group.count}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>

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
              {cases.map((item) => (
                <button
                  className={classNames(
                    "case-list-item",
                    item.caseId === selectedCaseId && "active",
                  )}
                  type="button"
                  key={item.caseId}
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
                    </small>
                  </p>
                  <ChevronRight size={15} />
                </button>
              ))}
              {hasMore && (
                <button
                  className="load-more"
                  type="button"
                  onClick={onLoadMore}
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
        {selectedCase && currentItem ? (
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
                  disabled={currentIndex <= 0}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={16} />
                  上一条
                </button>
                <button
                  className="button button-quiet button-small"
                  type="button"
                  disabled={currentIndex >= cases.length - 1}
                  onClick={() => move(1)}
                >
                  下一条
                  <ChevronRight size={16} />
                </button>
                <span className="toolbar-divider" />
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
                <span className="case-status">
                  <i />
                  数据有效
                </span>
              </div>

              <div className="detail-summary">
                <div>
                  <small>CaseID</small>
                  <strong>{selectedCaseId}</strong>
                </div>
                <div>
                  <small>所属 srNum</small>
                  <strong>{formatValue(selectedCase.srNum)}</strong>
                </div>
                <div>
                  <small>字段数量</small>
                  <strong>{Object.keys(selectedCase).length}</strong>
                </div>
                <div>
                  <small>最后更新</small>
                  <strong>{timeAgo(currentItem.updatedAt)}</strong>
                </div>
              </div>

              <div className="fields-heading">
                <div>
                  <h3>字段内容</h3>
                  <p>逐项查看和修改当前用例的数据</p>
                </div>
                <span>
                  <Pencil size={11} />
                  {Object.keys(selectedCase).length} 个字段 · 悬浮字段可编辑
                </span>
              </div>

              <div
                className={classNames(
                  "case-fields",
                  caseLoading && "case-fields-loading",
                )}
              >
                {Object.entries(selectedCase).map(([column, value]) => (
                  <EditableField
                    key={column}
                    caseId={selectedCaseId}
                    column={column}
                    value={value}
                    onUpdated={(data) => {
                      onCaseUpdate(data);
                      onToast(`“${column}”已保存`);
                    }}
                    onError={onToast}
                  />
                ))}
              </div>
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
              系统会读取 data Sheet，并以 CaseID 建立高性能索引。
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
    </div>
  );
}

function EditableField({
  caseId,
  column,
  value,
  onUpdated,
  onError,
}: {
  caseId: string;
  column: string;
  value: unknown;
  onUpdated: (data: CaseData) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatValue(value));
  const [saving, setSaving] = useState(false);
  const multiline = formatValue(value).length > 90 || /step|desc|expected/i.test(column);

  useEffect(() => {
    setDraft(formatValue(value));
  }, [value]);

  async function save() {
    if (draft === formatValue(value)) {
      setEditing(false);
      return;
    }
    setSaving(true);

    try {
      const response = await fetch(
        `/api/cases/${encodeURIComponent(caseId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column, value: draft }),
        },
      );
      const body = (await response.json()) as CaseData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      onUpdated(body);
      setEditing(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void save();
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
              onClick={() => void save()}
            >
              <Save size={14} />
              {saving ? "保存中" : "保存"}
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
            aria-label={`编辑 ${column}`}
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            编辑
          </button>
        </div>
      )}
    </article>
  );
}

function ImportModal({
  onClose,
  onImported,
  onToast,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<
    Array<{ fileName: string; error: string }>
  >([]);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  function addFiles(incoming: File[]) {
    const map = new Map(files.map((file) => [`${file.name}-${file.size}`, file]));
    incoming.forEach((file) => map.set(`${file.name}-${file.size}`, file));
    setFiles([...map.values()].slice(0, 30));
    setErrors([]);
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

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    setErrors([]);
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        results?: ImportResult[];
        errors?: Array<{ fileName: string; error: string }>;
        error?: string;
      };
      const results = body.results ?? [];
      const importErrors = body.errors ?? [];

      if (!response.ok && !results.length) {
        if (importErrors.length) setErrors(importErrors);
        else setErrors([{ fileName: "导入请求", error: body.error ?? "导入失败" }]);
        return;
      }

      const importedCount = results.reduce(
        (total, result) => total + result.imported,
        0,
      );
      await onImported();
      onToast(
        `已导入 ${countFormatter.format(importedCount)} 条用例，${results.length} 个文件`,
      );

      if (importErrors.length) {
        setErrors(importErrors);
        setFiles((current) =>
          current.filter((file) =>
            importErrors.some((error) => error.fileName === file.name),
          ),
        );
      } else {
        onClose();
      }
    } catch {
      setErrors([{ fileName: "导入请求", error: "连接中断，请重新尝试" }]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!uploading && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="import-modal-head">
          <div>
            <span className="import-head-icon">
              <ArrowDownToLine size={20} />
            </span>
            <div>
              <h2 id="import-title">批量导入用例</h2>
              <p>一次可选择最多 30 个表格或 ZIP 压缩包</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={uploading}
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div
          className={classNames("dropzone", dragging && "dragging")}
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
          <span className="dropzone-icon">
            <UploadCloud size={29} />
          </span>
          <h3>拖放表格或 ZIP 压缩包到这里</h3>
          <p>
            或
            <button type="button" onClick={() => inputRef.current?.click()}>
              浏览本机文件
            </button>
          </p>
          <small>
            支持 XLSX、XLS、XLSB、CSV、ODS、ZIP · 单文件不超过 200 MB
          </small>
        </div>

        <div className="import-requirements">
          <strong>导入要求</strong>
          <span>
            <Check size={13} /> 包含名为 data 的 Sheet
          </span>
          <span>
            <Check size={13} /> 包含 CaseID 和 srNum 列
          </span>
          <span>
            <Check size={13} /> ZIP 仅读取根目录和一层子目录
          </span>
        </div>

        {files.length > 0 && (
          <div className="selected-files">
            <div className="selected-files-heading">
              <strong>待导入文件</strong>
              <span>{files.length} 个</span>
            </div>
            <div className="selected-files-list">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`}>
                  <span>
                    {file.name.toLocaleLowerCase("en-US").endsWith(".zip") ? (
                      <FileArchive size={17} />
                    ) : (
                      <FileSpreadsheet size={17} />
                    )}
                  </span>
                  <p>
                    <strong>{file.name}</strong>
                    <small>
                      {file.size < 1024 * 1024
                        ? `${Math.max(file.size / 1024, 0.1).toFixed(1)} KB`
                        : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                    </small>
                  </p>
                  {!uploading && (
                    <button
                      className="icon-button"
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
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="import-errors">
            {errors.map((error) => (
              <div key={`${error.fileName}-${error.error}`}>
                <strong>{error.fileName}</strong>
                <span>{error.error}</span>
              </div>
            ))}
          </div>
        )}

        {uploading && (
          <div className="import-progress">
            <span />
            <p>正在本机解析并写入索引，请勿关闭窗口…</p>
          </div>
        )}

        <div className="import-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={uploading}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!files.length || uploading}
            onClick={() => void upload()}
          >
            {uploading ? <RefreshCw className="spin" size={17} /> : <UploadCloud size={17} />}
            {uploading ? "正在导入" : `开始导入${files.length ? ` (${files.length})` : ""}`}
          </button>
        </div>
      </section>
    </div>
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
    void navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
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
          </article>
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
