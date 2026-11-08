import { parse, stringify } from 'yaml';
import { mapLegacyIdeaContent, normalizeBody } from '../../domain/record/record';
import { defaults } from '../../shared/settings';
import type { FileSystem } from '../fs';
import { encode, splitRecordFrontmatter } from '../frontmatter';
import { Journal, createWrite } from '../journal';
import { recordSchema, recordV2Schema, settingsSchema, settingsV2Schema } from '../schemas';
import { stateSchema, stateV2Schema } from '../stateRepo';
import { migrateV2 } from './v2';
import type { MigrationOptions, MigrationResult } from './v2';

function readRawSchemaVersion(text: string, path: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(`${path}: invalid YAML`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: invalid state`);
  }
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) return undefined;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error(`${path}: invalid schemaVersion`);
  }
  return version;
}

export async function migrateV3(
  fs: FileSystem,
  options: MigrationOptions,
  extra?: { newDirectoryWithoutSettings?: boolean },
): Promise<MigrationResult> {
  const journal = new Journal(fs);
  await journal.recover();

  const stateFile = await fs.read('state.yaml');
  if (!stateFile) {
    throw new Error('state.yaml: missing state before v3 migration');
  }
  const stateVersion = readRawSchemaVersion(stateFile.text, 'state.yaml');
  const settingsFile = await fs.read('settings.yaml');
  const settingsVersion = settingsFile ? readRawSchemaVersion(settingsFile.text, 'settings.yaml') : undefined;

  if (stateVersion === 3) {
    try {
      stateSchema.parse(parse(stateFile.text));
    } catch (error) {
      throw new Error('state.yaml: invalid state', { cause: error });
    }
    if (settingsFile) {
      if (settingsVersion !== 3) {
        throw new Error('settings.yaml: invalid settings (schemaVersion 与 state.yaml 不一致)');
      }
      try {
        settingsSchema.parse(parse(settingsFile.text));
      } catch (error) {
        throw new Error('settings.yaml: invalid settings', { cause: error });
      }
    }
    return { migrated: false, backup: null, changes: [] };
  }

  if (stateVersion !== 2) {
    throw new Error(`state.yaml: invalid state (unsupported schemaVersion ${String(stateVersion)})`);
  }
  if (settingsFile && settingsVersion !== 2) {
    throw new Error(`settings.yaml: invalid settings (expected schemaVersion 2, got ${String(settingsVersion)})`);
  }

  let parsedStateV2: ReturnType<typeof stateV2Schema.parse>;
  let rawStateObj: Record<string, unknown>;
  try {
    const raw = parse(stateFile.text);
    rawStateObj = raw as Record<string, unknown>;
    parsedStateV2 = stateV2Schema.parse(raw);
  } catch (error) {
    throw new Error('state.yaml: invalid state', { cause: error });
  }

  let rawSettingsObj: Record<string, unknown> | null = null;
  let parsedSettingsV2: ReturnType<typeof settingsV2Schema.parse> | null = null;
  if (settingsFile) {
    try {
      const raw = parse(settingsFile.text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('mainTasks' in raw)) {
        throw new Error('settings.yaml: missing mainTasks');
      }
      rawSettingsObj = raw as Record<string, unknown>;
      parsedSettingsV2 = settingsV2Schema.parse(raw);
    } catch (error) {
      throw new Error('settings.yaml: invalid settings', { cause: error });
    }
  }

  const paths = (await fs.list('', true)).filter(path => !/^(attachments|\.journal|backup)\//.test(path));
  const originals = new Map<string, string>();
  for (const path of paths) {
    const file = await fs.read(path);
    if (!file) throw new Error(`迁移源文件消失：${path}`);
    originals.set(path, file.text);
  }

  const backup = `backup/v2-${options.now.replace(/[:.]/g, '-')}-${options.id()}`;
  for (const [path, text] of originals) {
    await fs.atomicWrite(`${backup}/${path}`, text);
    if ((await fs.read(`${backup}/${path}`))?.text !== text) {
      throw new Error(`备份验证失败：${path}`);
    }
  }

  const changes: string[] = [];
  const recordOutputs = new Map<string, string>();
  const recordPaths = [...originals.keys()]
    .filter(path => path.startsWith('records/') && path.endsWith('.md'))
    .sort();

  for (const path of recordPaths) {
    const rawText = originals.get(path)!;
    const { meta, rawBody, normalizedBody } = splitRecordFrontmatter(rawText, path);
    let recordV2: ReturnType<typeof recordV2Schema.parse>;
    try {
      recordV2 = recordV2Schema.parse(meta);
    } catch (error) {
      throw new Error(`${path}: invalid entity`, { cause: error });
    }
    if (recordV2.kind === '想法') {
      const { title, details } = mapLegacyIdeaContent(recordV2.text, rawBody, recordV2.attachments, path);
      const nextMeta: Record<string, unknown> = { ...meta, text: title };
      try {
        recordSchema.parse(nextMeta);
      } catch (error) {
        throw new Error(`${path}: invalid entity`, { cause: error });
      }
      const encoded = encode(nextMeta, details);
      recordOutputs.set(path, encoded);
      if (title !== recordV2.text || details !== rawBody) {
        changes.push(`record ${recordV2.id}: 想法标题与 Markdown 详情已按 v3 规则拆分`);
      }
    } else {
      if (! normalizeBody(recordV2.text).trim() && !normalizedBody.trim() && recordV2.attachments.length === 0) {
        throw new Error(`${path}: 记录内容或附件不能为空`);
      }
      try {
        recordSchema.parse(meta);
      } catch (error) {
        throw new Error(`${path}: invalid entity`, { cause: error });
      }
    }
  }

  const nextStateObj: Record<string, unknown> = {
    ...rawStateObj,
    ...parsedStateV2,
    schemaVersion: 3,
  };
  stateSchema.parse(nextStateObj);
  const nextStateText = stringify(nextStateObj);

  let nextSettingsText: string;
  if (extra?.newDirectoryWithoutSettings || !settingsFile || !rawSettingsObj || !parsedSettingsV2) {
    const freshSettings = structuredClone(defaults);
    settingsSchema.parse(freshSettings);
    nextSettingsText = stringify(freshSettings);
    changes.push('settings.yaml: 新目录默认配置 schemaVersion=3, mainTasks=2');
  } else {
    const nextMainTasks = parsedSettingsV2.mainTasks === 1 ? 2 : parsedSettingsV2.mainTasks;
    if (parsedSettingsV2.mainTasks === 1) {
      changes.push('settings.yaml: mainTasks 1 -> 2 (schemaVersion 2 -> 3)');
    } else {
      changes.push(`settings.yaml: mainTasks 保持 ${parsedSettingsV2.mainTasks} (schemaVersion 2 -> 3)`);
    }
    const nextSettingsObj: Record<string, unknown> = {
      ...structuredClone(rawSettingsObj),
      schemaVersion: 3,
      mainTasks: nextMainTasks,
    };
    try {
      settingsSchema.parse(nextSettingsObj);
    } catch (error) {
      throw new Error('settings.yaml: invalid settings', { cause: error });
    }
    nextSettingsText = stringify(nextSettingsObj);
  }

  const writes = [
    createWrite('state.yaml', nextStateText, originals.get('state.yaml') ?? null),
  ];
  for (const [path, text] of recordOutputs) {
    if (text !== (originals.get(path) ?? null)) {
      writes.push(createWrite(path, text, originals.get(path) ?? null));
    }
  }
  if (nextSettingsText !== (originals.get('settings.yaml') ?? null)) {
    writes.push(createWrite('settings.yaml', nextSettingsText, originals.get('settings.yaml') ?? null));
  }
  const logPath = `${backup}/迁移记录.md`;
  const logText = `# v2 → v3\n\n${changes.length ? changes.map(line => `- ${line}`).join('\n') : '无记录或设置字段调整。'}\n`;
  writes.push(createWrite(logPath, logText, null));

  await journal.run(options.id(), writes);
  return { migrated: true, backup, changes };
}

export async function migrateAll(fs: FileSystem, options: MigrationOptions): Promise<MigrationResult> {
  const journal = new Journal(fs);
  await journal.recover();

  const stateFile = await fs.read('state.yaml');
  const settingsFileBefore = await fs.read('settings.yaml');
  const existingEntries = (await fs.list('', true)).filter(path => !/^(attachments|\.journal|backup)\//.test(path));
  const newDirectoryWithoutSettings = !stateFile && !settingsFileBefore && existingEntries.length === 0;

  const stateVersion = stateFile ? readRawSchemaVersion(stateFile.text, 'state.yaml') : undefined;
  if (stateVersion !== undefined && stateVersion !== 1 && stateVersion !== 2 && stateVersion !== 3) {
    throw new Error(`state.yaml: invalid state (unsupported schemaVersion ${String(stateVersion)})`);
  }
  if (stateVersion === 3) {
    return migrateV3(fs, options);
  }

  let v2Result: MigrationResult = { migrated: false, backup: null, changes: [] };
  if (!stateFile || stateVersion === undefined || stateVersion === 1) {
    v2Result = await migrateV2(fs, options);
  }

  const v3Result = await migrateV3(fs, options, { newDirectoryWithoutSettings });
  return {
    migrated: (v2Result.migrated || v3Result.migrated) && !newDirectoryWithoutSettings,
    backup: v3Result.backup ?? v2Result.backup,
    changes: [...v2Result.changes, ...v3Result.changes],
  };
}
