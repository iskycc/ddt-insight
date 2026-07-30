import type {
  CaseData,
  CaseStepData,
  CellValue,
  JourneySteps,
} from "@/lib/types";

export const JOURNEY_FIELD = "用户旅程";

const STEP_NAME_PATTERN = /^step([1-9]\d*)$/i;

export function isCellValue(value: unknown): value is CellValue {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function normalizeStepName(value: string) {
  const match = STEP_NAME_PATTERN.exec(value.trim());
  return match ? `step${Number(match[1])}` : null;
}

export function stepNumber(value: string) {
  return Number(STEP_NAME_PATTERN.exec(value)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

export function sortStepNames(stepNames: string[]) {
  return [...stepNames].sort(
    (left, right) =>
      stepNumber(left) - stepNumber(right) ||
      left.localeCompare(right, "en-US"),
  );
}

export function isCaseStepData(value: unknown): value is CaseStepData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isCellValue);
}

export function isJourneySteps(value: unknown): value is JourneySteps {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([stepName, step]) =>
        normalizeStepName(stepName) === stepName && isCaseStepData(step),
    )
  );
}

export function isJourneyCase(data: CaseData): boolean {
  return isJourneySteps(data[JOURNEY_FIELD]);
}

export function getJourneySteps(data: CaseData): JourneySteps | null {
  const value = data[JOURNEY_FIELD];
  return isJourneySteps(value) ? value : null;
}

export function getJourneyStepNames(data: CaseData) {
  const steps = getJourneySteps(data);
  return steps ? sortStepNames(Object.keys(steps)) : [];
}

export function getCaseCell(data: CaseData, field: string): CellValue {
  const value = data[field];
  return isCellValue(value) ? value : null;
}

export function createJourneyCase(
  caseId: string,
  srNum: string,
  steps: JourneySteps,
): CaseData {
  return {
    CaseID: caseId,
    srNum,
    [JOURNEY_FIELD]: steps,
  };
}

export function synchronizeJourneyIdentity(
  data: CaseData,
  field: "CaseID" | "srNum",
  value: string,
): CaseData {
  const steps = getJourneySteps(data);
  if (!steps) return { ...data, [field]: value };

  return createJourneyCase(
    field === "CaseID" ? value : String(getCaseCell(data, "CaseID") ?? ""),
    field === "srNum" ? value : String(getCaseCell(data, "srNum") ?? ""),
    Object.fromEntries(
      Object.entries(steps).map(([stepName, step]) => [
        stepName,
        { ...step, [field]: value },
      ]),
    ),
  );
}
