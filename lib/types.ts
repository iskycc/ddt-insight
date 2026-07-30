export type CellValue = string | number | boolean | null;

export type CaseData = Record<string, CellValue>;

export interface CaseListItem {
  caseId: string;
  srNum: string;
  updatedAt: string;
  sourceName: string;
}

export interface ImportResult {
  fileName: string;
  imported: number;
  inserted: number;
  updated: number;
  srNums: number;
  durationMs: number;
}

export interface DashboardStats {
  totalCases: number;
  totalGroups: number;
  totalFiles: number;
  importedToday: number;
  updatedToday: number;
  groups: Array<{ srNum: string; count: number }>;
  timeline: Array<{ date: string; count: number }>;
  recentImports: Array<{
    id: string;
    fileName: string;
    rowCount: number;
    importedAt: string;
  }>;
}
