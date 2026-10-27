import { useEffect, useState } from 'react';
import type { SettingKey, Settings } from '../../shared/settings';
import { settingDefinitions } from '../../shared/settings';
import { SideNav, SplitLayout } from '../../ui/layout/SideNav';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { Group } from '../../ui/layout/GroupTitle';
import { Row } from '../../ui/layout/Row';
import { Slider } from '../../ui/controls/Slider';
import { Dropdown } from '../../ui/controls/Dropdown';
import { Segmented } from '../../ui/controls/Segmented';
import { Switch } from '../../ui/controls/Switch';
import { Swatch } from '../../ui/controls/Swatch';
import { HotkeyInput } from '../../ui/controls/HotkeyInput';
import { TextInput } from '../../ui/controls/TextInput';
import { Button } from '../../ui/controls/Button';
import { Emblem } from '../../ui/marks/Emblem';
import type { SettingRow } from './sections';
import { SECTIONS, UNIT_EN } from './sections';
import { ListEditor } from './ListEditor';
import './settings.css';

type Change = <K extends SettingKey>(key: K, value: Settings[K]) => void;

/**
 * 设置页：左侧 9 个分类，右侧面板。改动即时生效：每次改动都直接交给 onChange，由调用方保存，并在底栏闪一下「已保存 ✓」（见 SavedBadge）。
 * 快捷键冲突等保存失败的原因，通过 errors 按 key 显示在对应那一行。
 */
export function SettingsPage({ section, onSection, settings, onChange, onListsChange, dataDir, onChangeDir, errors = {}, version }:
  { section: string; onSection: (id: string) => void; settings: Settings; onChange: Change;
    onListsChange: (lists: Settings['lists']) => void; dataDir: string; onChangeDir: () => void;
    errors?: Partial<Record<SettingKey, string>>; version: string }) {
  const sec = SECTIONS.find(s => s.id === section) ?? SECTIONS[0];
  const lists = settings.lists;
  const control = (row: SettingRow) => {
    if ('custom' in row) {
      switch (row.custom) {
        case 'idleName': return <TextInput aria-label={row.cn} value={lists.idleName} style={{ width: 200 }} onChange={e => onListsChange({ ...lists, idleName: e.target.value })} />;
        case 'quickActivities': return <ListEditor withCategory items={lists.quickActivities} placeholder="例如：厕所、拿快递、吃饭"
          onChange={items => onListsChange({ ...lists, quickActivities: items.map(i => ({ id: i.id, name: i.name, category: i.category ?? '生活' })) })} />;
        case 'restPool': return <ListEditor withCategory={false} items={lists.restPool} placeholder="例如：眺望窗外、走走、洗脸、收拾桌面"
          onChange={items => onListsChange({ ...lists, restPool: items.map(i => ({ id: i.id, name: i.name })) })} />;
        case 'dataDir': return <><code className="st-path">{dataDir}</code><Button onClick={onChangeDir}>更换</Button></>;
        case 'about': return null;
      }
    }
    const def = settingDefinitions[row.key];
    const value = settings[row.key];
    const set = (v: unknown) => onChange(row.key, v as Settings[typeof row.key]);
    if (def.type === 'boolean') return <Switch label={row.cn} checked={value as boolean} onChange={set} />;
    if (def.type === 'string') return <HotkeyInput label={row.cn} value={value as string} onChange={set} />;
    if (def.type === 'enum') {
      const opts = def.options.map(o => ({ value: o as string, label: row.labels?.[o] ?? o, name: row.labels?.[o] ?? o }));
      return row.key === 'accent' ? <Swatch label={row.cn} options={opts} value={value as string} onChange={set} />
        : <Segmented label={row.cn} options={opts} value={value as string} onChange={set} />;
    }
    if (row.control === 'dropdown' && row.labels) {
      return <Dropdown label={row.cn} value={value as number} onChange={set}
        options={Array.from({ length: def.max - def.min + 1 }, (_, n) => def.min + n).map(v => ({ value: v, label: row.labels![v] ?? String(v) }))} />;
    }
    return <Slider label={row.cn} value={value as number} min={def.min} max={def.max} step={def.step} unit={UNIT_EN[def.unit] ?? ''} onChange={set} />;
  };
  const nav = SECTIONS.map(s => ({ id: s.id, no: s.no, cn: s.cn, en: s.en }));
  return <SplitLayout nav={<SideNav en="SETTINGS" cn="设置" items={nav} active={sec.id} onSelect={onSection}
    foot={<><Emblem /><div><b>像素记录</b><span>v{version}</span></div></>} />}>
    <PanelHeader no={sec.no} en={sec.en} cn={sec.cn} desc={sec.desc || undefined} />
    {sec.id === 'about' ? <div className="st-about"><Emblem strokeWidth={1.6} /><div>
      <span className="k">PIXEL RECORD</span><h4>像素记录</h4>
      <p>帮你做减法的决策系统：写一行，剩下的交给提前定好的规则。首页只显示一件事。</p>
      <small>v{version} · 数据是一个文件夹里的 Markdown 文件</small>
    </div></div>
      : sec.groups.map(g => <Group key={g.cn} cn={g.cn} en={g.en}>
        {g.rows.map(r => {
          const id = 'custom' in r ? r.custom : r.key;
          const err = 'key' in r ? errors[r.key] : undefined;
          const block = 'custom' in r && (r.custom === 'quickActivities' || r.custom === 'restPool');
          const row = <Row key={id} title={r.cn} desc={err ? <span className="st-err">{err}</span> : r.desc}>{control(r)}</Row>;
          return block ? <div key={id} className="st-block">{row}</div> : row;
        })}
      </Group>)}
  </SplitLayout>;
}

/** 底栏的「已保存 ✓」：saves 每加 1 就闪一下（1.2 秒）。由外壳放进底栏。 */
export function SavedBadge({ saves }: { saves: number }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!saves) return;
    setOk(true);
    const t = setTimeout(() => setOk(false), 1200);
    return () => clearTimeout(t);
  }, [saves]);
  return <span className={`saved${ok ? ' ok' : ''}`}>{ok ? '已保存 ✓' : '更改即时生效'}</span>;
}
