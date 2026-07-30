"use client";

import {
  Download,
  FileSearch,
  LayoutTemplate,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CustomCheckbox, CustomSelect } from "@/components/custom-controls";
import styles from "./case-management-tools.module.css";

type CellValue = string | number | boolean | null;
type FieldType = "string" | "number" | "boolean" | "date";
type SearchOperator =
  | "eq"
  | "ne"
  | "contains"
  | "prefix"
  | "exists"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

interface TemplateRule {
  field: string;
  required: boolean;
  type: FieldType;
  enumValues?: CellValue[];
  defaultValue?: CellValue;
}

interface TemplateItem {
  id: string;
  srNum: string;
  name: string;
  description: string;
  rules: TemplateRule[];
  updatedAt: string;
}

interface SearchResultItem {
  caseId: string;
  srNum: string;
  sourceName: string;
  updatedAt: string;
}

interface FieldFilterDraft {
  id: string;
  field: string;
  operator: SearchOperator;
  value: string;
}

async function responseJson<T>(response: Response) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "操作失败");
  return body;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function valueFromInput(value: string, type: string): CellValue {
  if (type === "null") return null;
  if (type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("请输入有效数字");
    return number;
  }
  if (type === "boolean") return value === "true";
  return value;
}

function formatCellValue(value: CellValue) {
  if (value === null) return "null（空值）";
  if (value === "") return "（空字符串）";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export interface BulkCaseActionsProps {
  selectedCaseIds: string[];
  onCasesChanged?: (result: {
    changed?: number;
    deleted?: number;
    missing?: string[];
  }) => void | Promise<void>;
  onSelectionCleared?: () => void;
}

export function BulkCaseActions({
  selectedCaseIds,
  onCasesChanged,
  onSelectionCleared,
}: BulkCaseActionsProps) {
  const [field, setField] = useState("srNum");
  const [valueType, setValueType] = useState("string");
  const [value, setValue] = useState("");
  const [booleanValue, setBooleanValue] = useState("true");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    field: string;
    value: CellValue;
  } | null>(null);
  const updateConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const disabled = !selectedCaseIds.length || Boolean(busy);

  useEffect(() => {
    if (!pendingUpdate) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    const focusTimer = window.setTimeout(() => {
      updateConfirmButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        setPendingUpdate(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("modal-open");
      previousFocus?.focus();
    };
  }, [pendingUpdate, busy]);

  function reviewUpdate() {
    setMessage("");
    setError("");
    try {
      const targetField = field.trim();
      if (!targetField) throw new Error("请输入目标字段");
      setPendingUpdate({
        field: targetField,
        value: valueFromInput(
          valueType === "boolean" ? booleanValue : value,
          valueType,
        ),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改内容不正确");
    }
  }

  async function updateCases() {
    if (!pendingUpdate) return;
    setBusy("update");
    setMessage("");
    setError("");
    try {
      const result = await responseJson<{
        changed: number;
        skipped: number;
        missing: string[];
      }>(
        await fetch("/api/cases/bulk/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseIds: selectedCaseIds,
            changes: { [pendingUpdate.field]: pendingUpdate.value },
          }),
        }),
      );
      setPendingUpdate(null);
      setMessage(
        `已更新 ${result.changed} 条，跳过 ${result.skipped} 条${
          result.missing.length ? `，${result.missing.length} 条已不存在` : ""
        }`,
      );
      await onCasesChanged?.({
        changed: result.changed,
        missing: result.missing,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量修改失败");
    } finally {
      setBusy("");
    }
  }

  async function exportCases() {
    setBusy("export");
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/cases/bulk/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds: selectedCaseIds }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "导出失败");
      }
      downloadBlob(
        await response.blob(),
        `ddt-selected-cases-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      setMessage(`已导出 ${selectedCaseIds.length} 条用例`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteCases() {
    setBusy("delete");
    setMessage("");
    setError("");
    try {
      const result = await responseJson<{
        deleted: number;
        notFound: string[];
      }>(
        await fetch("/api/cases/bulk/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseIds: selectedCaseIds }),
        }),
      );
      setConfirmDelete(false);
      setMessage(
        `已将 ${result.deleted} 条用例移至回收站${
          result.notFound.length
            ? `，${result.notFound.length} 条已不存在`
            : ""
        }`,
      );
      onSelectionCleared?.();
      await onCasesChanged?.({
        deleted: result.deleted,
        missing: result.notFound,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "批量移至回收站失败",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <h3>批量管理</h3>
          <p>
            修改会逐条记录永久历史；用户旅程会更新全部同名 Step
            字段，新字段写入 step1。
          </p>
        </div>
        <span className={styles.count}>已选 {selectedCaseIds.length} 条</span>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>目标字段</span>
          <input
            className={styles.input}
            value={field}
            maxLength={256}
            placeholder="例如 srNum、Owner、Priority"
            onChange={(event) => setField(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>值类型</span>
          <CustomSelect
            value={valueType}
            ariaLabel="批量修改值类型"
            className={styles.select}
            options={[
              { value: "string", label: "文本" },
              { value: "number", label: "数字" },
              { value: "boolean", label: "布尔值" },
              { value: "null", label: "空值" },
            ]}
            onChange={setValueType}
          />
        </label>
      </div>

      {valueType === "boolean" ? (
        <CustomSelect
          value={booleanValue}
          ariaLabel="批量修改布尔值"
          className={styles.select}
          options={[
            { value: "true", label: "True" },
            { value: "false", label: "False" },
          ]}
          onChange={setBooleanValue}
        />
      ) : valueType !== "null" ? (
        <label className={styles.field}>
          <span>新值</span>
          <input
            className={styles.input}
            value={value}
            placeholder="输入批量写入的值"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      ) : null}

      <div className={styles.actions}>
        <button
          className={`${styles.button} ${styles.buttonSecondary}`}
          type="button"
          disabled={disabled}
          onClick={exportCases}
        >
          {busy === "export" ? (
            <LoaderCircle size={16} />
          ) : (
            <Download size={16} />
          )}
          导出所选
        </button>
        <button
          className={styles.dangerButton}
          type="button"
          disabled={disabled}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={16} />
          移至回收站
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={disabled || !field.trim()}
          onClick={reviewUpdate}
        >
          <Save size={16} />
          应用修改
        </button>
      </div>
      {message && <p className={styles.notice}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {pendingUpdate && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bulk-update-title"
            aria-describedby="bulk-update-description"
          >
            <h3 id="bulk-update-title">确认应用这次批量修改？</h3>
            <p id="bulk-update-description">
              请再次核对影响范围和目标值。确认后会逐条更新用例，并为每条用例永久记录修改历史。
            </p>
            <dl className={styles.reviewSummary}>
              <div>
                <dt>影响用例</dt>
                <dd>{selectedCaseIds.length} 条</dd>
              </div>
              <div>
                <dt>目标字段</dt>
                <dd>{pendingUpdate.field}</dd>
              </div>
              <div>
                <dt>写入值</dt>
                <dd>{formatCellValue(pendingUpdate.value)}</dd>
              </div>
              <div>
                <dt>CaseID 摘要</dt>
                <dd>
                  {selectedCaseIds.slice(0, 4).join("、")}
                  {selectedCaseIds.length > 4
                    ? ` 等 ${selectedCaseIds.length} 条`
                    : ""}
                </dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setPendingUpdate(null)}
              >
                返回检查
              </button>
              <button
                ref={updateConfirmButtonRef}
                className={styles.button}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void updateCases()}
              >
                {busy === "update" ? (
                  <LoaderCircle size={16} />
                ) : (
                  <Save size={16} />
                )}
                {busy === "update" ? "正在应用" : "确认应用"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-delete-title"
          >
            <h3 id="bulk-delete-title">将所选用例移至回收站？</h3>
            <p>
              共 {selectedCaseIds.length} 条用例。管理员可以从回收站恢复，
              本次操作会写入审计日志。
            </p>
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={Boolean(busy)}
                onClick={deleteCases}
              >
                {busy === "delete" && <LoaderCircle size={16} />}
                确认移入回收站
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export interface AdvancedCaseSearchProps {
  onOpenCase?: (caseId: string) => void;
}

export function AdvancedCaseSearch({
  onOpenCase,
}: AdvancedCaseSearchProps) {
  const [caseIdPrefix, setCaseIdPrefix] = useState("");
  const [text, setText] = useState("");
  const [srNum, setSrNum] = useState("");
  const [filters, setFilters] = useState<FieldFilterDraft[]>([]);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestFilters = useMemo(
    () =>
      filters
        .filter((filter) => filter.field.trim())
        .map((filter) => ({
          field: filter.field.trim(),
          operator: filter.operator,
          ...(filter.operator !== "exists" ? { value: filter.value } : {}),
        })),
    [filters],
  );

  const runSearch = useCallback(
    async (append = false) => {
      setLoading(true);
      setError("");
      try {
        const result = await responseJson<{
          items: SearchResultItem[];
          hasMore: boolean;
          nextCursor: string | null;
        }>(
          await fetch("/api/cases/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              caseIdPrefix,
              text,
              srNum,
              filters: requestFilters,
              cursor: append ? cursor : "",
              limit: 50,
            }),
          }),
        );
        setItems((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "搜索失败");
      } finally {
        setLoading(false);
      }
    },
    [caseIdPrefix, cursor, requestFilters, srNum, text],
  );

  function addFilter() {
    setFilters((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        field: "",
        operator: "contains",
        value: "",
      },
    ]);
  }

  function updateFilter(id: string, change: Partial<FieldFilterDraft>) {
    setFilters((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <h3>高级检索</h3>
          <p>CaseID 前缀优先走索引，可叠加全文和动态字段条件。</p>
        </div>
        <FileSearch size={22} />
      </div>
      <div className={styles.searchGrid}>
        <label className={styles.field}>
          <span>CaseID 前缀</span>
          <input
            className={styles.input}
            value={caseIdPrefix}
            placeholder="快速定位，例如 TC-PAY-"
            onChange={(event) => setCaseIdPrefix(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>srNum</span>
          <input
            className={styles.input}
            value={srNum}
            placeholder="精确匹配分组"
            onChange={(event) => setSrNum(event.target.value)}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span>全文关键词</span>
        <input
          className={styles.input}
          value={text}
          placeholder="搜索 CaseID、srNum、来源和所有动态字段"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch(false);
          }}
        />
      </label>

      <div className={styles.filters}>
        {filters.map((filter) => (
          <div className={styles.filterRow} key={filter.id}>
            <input
              className={styles.input}
              value={filter.field}
              aria-label="动态字段名"
              placeholder="字段名"
              onChange={(event) =>
                updateFilter(filter.id, { field: event.target.value })
              }
            />
            <CustomSelect
              value={filter.operator}
              ariaLabel="字段匹配方式"
              className={styles.select}
              options={[
                { value: "contains", label: "包含" },
                { value: "eq", label: "等于" },
                { value: "ne", label: "不等于" },
                { value: "prefix", label: "前缀" },
                { value: "exists", label: "存在" },
                { value: "gt", label: "大于" },
                { value: "gte", label: "大于等于" },
                { value: "lt", label: "小于" },
                { value: "lte", label: "小于等于" },
              ]}
              onChange={(operator) =>
                updateFilter(filter.id, {
                  operator: operator as SearchOperator,
                })
              }
            />
            <input
              className={styles.input}
              value={filter.value}
              aria-label="动态字段值"
              placeholder={filter.operator === "exists" ? "无需填写" : "值"}
              disabled={filter.operator === "exists"}
              onChange={(event) =>
                updateFilter(filter.id, { value: event.target.value })
              }
            />
            <button
              className={styles.iconButton}
              type="button"
              aria-label="移除字段条件"
              onClick={() =>
                setFilters((current) =>
                  current.filter((item) => item.id !== filter.id),
                )
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.button} ${styles.buttonSecondary}`}
          type="button"
          disabled={filters.length >= 10}
          onClick={addFilter}
        >
          <Plus size={16} />
          添加字段条件
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={loading}
          onClick={() => void runSearch(false)}
        >
          {loading ? <LoaderCircle size={16} /> : <Search size={16} />}
          搜索
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.results}>
        {items.map((item) => (
          <button
            className={styles.result}
            type="button"
            key={item.caseId}
            onClick={() => onOpenCase?.(item.caseId)}
          >
            <strong>{item.caseId}</strong>
            <span className={styles.resultMeta}>
              <span>{item.srNum}</span>
              <span>{item.sourceName}</span>
              <time>{new Date(item.updatedAt).toLocaleString("zh-CN")}</time>
            </span>
          </button>
        ))}
        {!loading && !items.length && (
          <div className={styles.empty}>设置条件后开始搜索</div>
        )}
      </div>
      {hasMore && (
        <button
          className={`${styles.button} ${styles.buttonSecondary}`}
          type="button"
          disabled={loading}
          onClick={() => void runSearch(true)}
        >
          加载更多
        </button>
      )}
    </section>
  );
}

export interface CaseTemplateManagerProps {
  initialSrNum?: string;
  onTemplatesChanged?: () => void | Promise<void>;
}

function blankRule(): TemplateRule {
  return { field: "", required: false, type: "string" };
}

export function CaseTemplateManager({
  initialSrNum = "",
  onTemplatesChanged,
}: CaseTemplateManagerProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [srNum, setSrNum] = useState(initialSrNum);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<TemplateRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadTemplates = useCallback(async () => {
    try {
      const result = await responseJson<{ items: TemplateItem[] }>(
        await fetch("/api/templates", { cache: "no-store" }),
      );
      setTemplates(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载模板失败");
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function reset() {
    setEditingId(null);
    setSrNum(initialSrNum);
    setName("");
    setDescription("");
    setRules([]);
    setError("");
    setMessage("");
  }

  function edit(template: TemplateItem) {
    setEditingId(template.id);
    setSrNum(template.srNum);
    setName(template.name);
    setDescription(template.description);
    setRules(template.rules);
    setError("");
    setMessage("");
  }

  function updateRule(index: number, change: Partial<TemplateRule>) {
    setRules((current) =>
      current.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...change } : rule,
      ),
    );
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        editingId ? `/api/templates/${editingId}` : "/api/templates",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ srNum, name, description, rules }),
        },
      );
      await responseJson<TemplateItem>(response);
      setMessage(editingId ? "模板已更新" : "模板已创建");
      await loadTemplates();
      await onTemplatesChanged?.();
      if (!editingId) reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存模板失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: TemplateItem) {
    setBusy(true);
    setError("");
    try {
      await responseJson<{ success: boolean }>(
        await fetch(`/api/templates/${template.id}`, { method: "DELETE" }),
      );
      if (editingId === template.id) reset();
      await loadTemplates();
      await onTemplatesChanged?.();
      setMessage(`已删除模板“${template.name}”`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除模板失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <h3>用例模板与校验</h3>
          <p>规则按 srNum 生效；未配置模板的动态表格保持原样。</p>
        </div>
        <LayoutTemplate size={22} />
      </div>
      <div className={styles.templates}>
        {templates.map((template) => (
          <div className={styles.templateItem} key={template.id}>
            <div>
              <strong>{template.name}</strong>
              <small>
                {template.srNum} · {template.rules.length} 条字段规则
              </small>
            </div>
            <div className={styles.row}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                type="button"
                onClick={() => edit(template)}
              >
                编辑
              </button>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={`删除模板 ${template.name}`}
                disabled={busy}
                onClick={() => void remove(template)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.ruleHeader}>
          <h4>{editingId ? "编辑模板" : "新建模板"}</h4>
          {editingId && (
            <button
              className={styles.iconButton}
              type="button"
              aria-label="退出模板编辑"
              onClick={reset}
            >
              <RotateCcw size={15} />
            </button>
          )}
        </div>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>匹配 srNum</span>
            <input
              className={styles.input}
              value={srNum}
              placeholder="例如 SR-PAYMENT"
              onChange={(event) => setSrNum(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>模板名称</span>
            <input
              className={styles.input}
              value={name}
              placeholder="例如 支付回归用例"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <label className={styles.field}>
          <span>说明</span>
          <textarea
            className={styles.textarea}
            value={description}
            placeholder="说明模板用途和维护约定"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className={styles.rules}>
          {rules.map((rule, index) => (
            <div className={styles.rule} key={`${index}-${rule.field}`}>
              <div className={styles.ruleHeader}>
                <strong>字段规则 {index + 1}</strong>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="移除字段规则"
                  onClick={() =>
                    setRules((current) =>
                      current.filter((_, currentIndex) => currentIndex !== index),
                    )
                  }
                >
                  <X size={15} />
                </button>
              </div>
              <div className={styles.ruleGrid}>
                <label className={styles.field}>
                  <span>字段名</span>
                  <input
                    className={styles.input}
                    value={rule.field}
                    onChange={(event) =>
                      updateRule(index, { field: event.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>类型</span>
                  <CustomSelect
                    value={rule.type}
                    ariaLabel={`字段规则 ${index + 1} 类型`}
                    className={styles.select}
                    options={[
                      { value: "string", label: "文本" },
                      { value: "number", label: "数字" },
                      { value: "boolean", label: "布尔值" },
                      { value: "date", label: "日期" },
                    ]}
                    onChange={(type) =>
                      updateRule(index, { type: type as FieldType })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>默认值</span>
                  <input
                    className={styles.input}
                    value={
                      rule.defaultValue === undefined
                        ? ""
                        : String(rule.defaultValue ?? "")
                    }
                    placeholder="留空表示不设置"
                    onChange={(event) =>
                      updateRule(index, {
                        defaultValue:
                          event.target.value === ""
                            ? undefined
                            : valueFromInput(event.target.value, rule.type),
                      })
                    }
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>枚举值（逗号分隔）</span>
                <input
                  className={styles.input}
                  value={rule.enumValues?.join(",") ?? ""}
                  placeholder="留空表示不限制"
                  onChange={(event) =>
                    updateRule(index, {
                      enumValues: event.target.value
                        ? event.target.value
                            .split(",")
                            .map((item) =>
                              valueFromInput(item.trim(), rule.type),
                            )
                        : undefined,
                    })
                  }
                />
              </label>
              <CustomCheckbox
                checked={rule.required}
                compact
                label="必填字段"
                onChange={(required) => updateRule(index, { required })}
              />
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            type="button"
            disabled={rules.length >= 200}
            onClick={() => setRules((current) => [...current, blankRule()])}
          >
            <Plus size={16} />
            添加字段规则
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={busy || !srNum.trim() || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? <LoaderCircle size={16} /> : <Save size={16} />}
            保存模板
          </button>
        </div>
      </div>
      {message && <p className={styles.notice}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

export interface CaseManagementToolsProps
  extends AdvancedCaseSearchProps,
    CaseTemplateManagerProps {
  section: "search" | "templates";
}

export function CaseManagementTools({
  onOpenCase,
  initialSrNum,
  onTemplatesChanged,
  section,
}: CaseManagementToolsProps) {
  return (
    <div className={`${styles.shell} workspace-page`}>
      {section === "search" && <AdvancedCaseSearch onOpenCase={onOpenCase} />}
      {section === "templates" && (
        <CaseTemplateManager
          initialSrNum={initialSrNum}
          onTemplatesChanged={onTemplatesChanged}
        />
      )}
    </div>
  );
}
