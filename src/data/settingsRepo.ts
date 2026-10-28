import { parse, stringify } from 'yaml';
import type { Settings } from '../shared/settings';
import { defaults } from '../shared/settings';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';
import { settingsSchema } from './schemas';

function readSettings(text: string): Settings {
  return settingsSchema.parse(parse(text));
}

export class SettingsRepo {
  constructor(private fs: FileSystem) {}
  async read(): Promise<Settings> {
    const file = await this.fs.read('settings.yaml');
    // A missing file is a new data directory. Invalid existing data never falls back.
    if (!file) return structuredClone(defaults);
    try { return readSettings(file.text); }
    catch (error) { throw new Error('settings.yaml: invalid settings', { cause: error }); }
  }
  async write(value: Settings): Promise<Write> {
    const file = await this.fs.read('settings.yaml');
    try {
      const original = file ? readSettings(file.text) : null;
      const settings = settingsSchema.parse({ ...original, ...value, lists: { ...original?.lists, ...value.lists } });
      return createWrite('settings.yaml', stringify(settings), file?.text ?? null);
    } catch (error) { throw new Error('settings.yaml: invalid settings', { cause: error }); }
  }
}
