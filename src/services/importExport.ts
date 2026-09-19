import type { ExportBundle } from '../domain/types';
import { db } from '../storage/db';

export const SCHEMA_VERSION = 1;

export async function exportAll(): Promise<string> {
  const [
    courses,
    projects,
    milestones,
    tasks,
    blocks,
    weeklyOutcomes,
    reviews,
    settings,
  ] = await Promise.all([
    db.courses.toArray(),
    db.projects.toArray(),
    db.milestones.toArray(),
    db.tasks.toArray(),
    db.blocks.toArray(),
    db.weeklyOutcomes.toArray(),
    db.reviews.toArray(),
    db.settings.get('app'),
  ]);
  const bundle: ExportBundle = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      courses,
      projects,
      milestones,
      tasks,
      blocks,
      weeklyOutcomes,
      reviews,
      // 剥离 AI 配置（API Key、个人背景）：敏感信息不出设备，换机器后重新填写
      settings: settings ? { ...settings, ai: undefined } : null,
    },
  };
  return JSON.stringify(bundle, null, 2);
}

export class ImportError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireArray(data: Record<string, unknown>, key: string): unknown[] {
  const v = data[key];
  if (!Array.isArray(v)) {
    throw new ImportError(`导入文件缺少 "${key}" 数组或格式不正确。`);
  }
  return v;
}

/** Validate that every record has the mandatory fields for its entity. */
function validateRecords(
  arr: unknown[],
  label: string,
  required: string[],
): Record<string, unknown>[] {
  return arr.map((item, i) => {
    if (!isRecord(item)) {
      throw new ImportError(`${label} 第 ${i + 1} 条不是有效对象。`);
    }
    for (const field of required) {
      if (!(field in item)) {
        throw new ImportError(`${label} 第 ${i + 1} 条缺少字段 "${field}"。`);
      }
    }
    return item;
  });
}

export function parseImport(json: string): ExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportError('不是有效的 JSON 文件。');
  }
  if (!isRecord(parsed)) throw new ImportError('导入文件格式不正确。');
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new ImportError(
      `schema 版本不匹配（文件为 ${String(parsed.schemaVersion)}，当前为 ${SCHEMA_VERSION}）。`,
    );
  }
  if (!isRecord(parsed.data)) throw new ImportError('导入文件缺少 data。');

  const d = parsed.data;
  const bundle: ExportBundle = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    data: {
      courses: validateRecords(requireArray(d, 'courses'), 'courses', ['id', 'name']) as unknown as ExportBundle['data']['courses'],
      projects: validateRecords(requireArray(d, 'projects'), 'projects', ['id', 'name', 'status']) as unknown as ExportBundle['data']['projects'],
      milestones: validateRecords(requireArray(d, 'milestones'), 'milestones', ['id', 'projectId']) as unknown as ExportBundle['data']['milestones'],
      tasks: validateRecords(requireArray(d, 'tasks'), 'tasks', ['id', 'title', 'status']) as unknown as ExportBundle['data']['tasks'],
      blocks: validateRecords(requireArray(d, 'blocks'), 'blocks', ['id', 'start', 'end']) as unknown as ExportBundle['data']['blocks'],
      weeklyOutcomes: requireArray(d, 'weeklyOutcomes') as ExportBundle['data']['weeklyOutcomes'],
      reviews: requireArray(d, 'reviews') as ExportBundle['data']['reviews'],
      settings: isRecord(d.settings) ? (d.settings as unknown as ExportBundle['data']['settings']) : null,
    },
  };
  return bundle;
}

export async function importAll(bundle: ExportBundle): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.courses,
      db.projects,
      db.milestones,
      db.tasks,
      db.blocks,
      db.weeklyOutcomes,
      db.reviews,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.courses.clear(),
        db.projects.clear(),
        db.milestones.clear(),
        db.tasks.clear(),
        db.blocks.clear(),
        db.weeklyOutcomes.clear(),
        db.reviews.clear(),
      ]);
      await db.courses.bulkPut(bundle.data.courses);
      await db.projects.bulkPut(bundle.data.projects);
      await db.milestones.bulkPut(bundle.data.milestones);
      await db.tasks.bulkPut(bundle.data.tasks);
      await db.blocks.bulkPut(bundle.data.blocks);
      await db.weeklyOutcomes.bulkPut(bundle.data.weeklyOutcomes);
      await db.reviews.bulkPut(bundle.data.reviews);
      if (bundle.data.settings) {
        await db.settings.put({
          ...bundle.data.settings,
          initialized: true,
          id: 'app',
        });
      }
    },
  );
}

export function downloadJSON(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
