import { db } from "@/lib/db";

export interface SystemSettings {
  maxImportMb: number;
  maxArchiveUncompressedMb: number;
  maxImportFiles: number;
  maxArchiveEntries: number;
}

export const defaultSystemSettings: SystemSettings = {
  maxImportMb: 200,
  maxArchiveUncompressedMb: 200,
  maxImportFiles: 30,
  maxArchiveEntries: 500,
};

const settingKeys = Object.keys(defaultSystemSettings) as Array<
  keyof SystemSettings
>;

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getSystemSettingNumber<K extends keyof SystemSettings>(
  key: K,
): number {
  const fallback = defaultSystemSettings[key];
  const row = db
    .prepare("SELECT value_json FROM system_settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) {
    db.prepare(
      "INSERT OR IGNORE INTO system_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)",
    ).run(
      key,
      JSON.stringify({ value: fallback }),
      new Date().toISOString(),
      "system",
    );
    return fallback;
  }
  try {
    const parsed = JSON.parse(row.value_json) as { value?: unknown };
    return parseNumber(parsed.value, fallback);
  } catch {
    return fallback;
  }
}

export function getSystemSettings(): SystemSettings {
  return {
    maxImportMb: getSystemSettingNumber("maxImportMb"),
    maxArchiveUncompressedMb: getSystemSettingNumber(
      "maxArchiveUncompressedMb",
    ),
    maxImportFiles: getSystemSettingNumber("maxImportFiles"),
    maxArchiveEntries: getSystemSettingNumber("maxArchiveEntries"),
  };
}

const settingRanges: Record<keyof SystemSettings, { min: number; max: number }> =
  {
    maxImportMb: { min: 1, max: 8192 },
    maxArchiveUncompressedMb: { min: 1, max: 8192 },
    maxImportFiles: { min: 1, max: Number.MAX_SAFE_INTEGER },
    maxArchiveEntries: { min: 1, max: Number.MAX_SAFE_INTEGER },
  };

export function validateSystemSettings(
  input: Partial<SystemSettings>,
): { valid: true } | { valid: false; error: string } {
  for (const key of settingKeys) {
    if (!(key in input)) continue;
    const raw = input[key];
    const value = typeof raw === "string" ? Number(raw) : Number(raw);
    if (!Number.isInteger(value)) {
      return { valid: false, error: `${key} 必须是整数` };
    }
    const range = settingRanges[key];
    if (value < range.min) {
      return { valid: false, error: `${key} 必须大于等于 ${range.min}` };
    }
    if (range.max < Number.MAX_SAFE_INTEGER && value > range.max) {
      return { valid: false, error: `${key} 不能超过 ${range.max}` };
    }
  }
  return { valid: true };
}

export function updateSystemSettings(
  input: Partial<SystemSettings>,
  updatedBy: string,
): SystemSettings {
  const validation = validateSystemSettings(input);
  if (!validation.valid) throw new Error(validation.error);

  const now = new Date().toISOString();
  const update = db.prepare(
    "INSERT INTO system_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
  );
  for (const key of settingKeys) {
    if (key in input) {
      update.run(key, JSON.stringify({ value: input[key] }), now, updatedBy);
    }
  }
  return getSystemSettings();
}
