import { useState } from 'react';
import { Frame, StatusBar } from '../frame/StatusBar';
import { TitleBar } from '../frame/TitleBar';
import { WindowButtons } from '../frame/WindowButtons';
import { ActionButton, Button } from '../controls/Button';
import { Segmented } from '../controls/Segmented';
import { Switch } from '../controls/Switch';
import { Slider } from '../controls/Slider';
import { Dropdown } from '../controls/Dropdown';
import { Keycap } from '../controls/Keycap';
import { Swatch } from '../controls/Swatch';
import { TextInput } from '../controls/TextInput';
import { TextArea } from '../controls/TextArea';
import { DateTimeInput } from '../controls/DateTimeInput';
import { Chip } from '../controls/Chip';
import { HotkeyInput } from '../controls/HotkeyInput';
import { ProjectPicker } from '../controls/ProjectPicker';
import type { ProjectOption } from '../controls/ProjectPicker';
import { TagPicker } from '../controls/TagPicker';
import { ToastStack } from '../overlay/Toast';
import { ContextMenu } from '../overlay/ContextMenu';
import { Dialog } from '../overlay/Dialog';
import { SideNav, SplitLayout } from '../layout/SideNav';
import { PanelHeader } from '../layout/PanelHeader';
import { Group } from '../layout/GroupTitle';
import { Row } from '../layout/Row';
import { VBars, MiniBars } from '../marks/VBars';
import { TagStrip } from '../marks/TagStrip';
import { Corners } from '../marks/Corners';
import { Emblem } from '../marks/Emblem';
import { TrackMark } from '../marks/TrackMark';
import { StatusTag } from '../marks/StatusLed';
import { Readout } from '../marks/Readout';
import { ActTile, AddTile } from '../marks/ActTile';
import { Icon } from '../icons/Icon';
import { Topo } from '../effects/Topo';
import { ScanLine } from '../effects/ScanLine';
import { Wipe } from '../effects/Wipe';
import { CutIn } from '../effects/CutIn';
import './gallery.css';

const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }, { id: 'parts', cn: '部件', en: 'PARTS' },
  { id: 'pickers', cn: '选择器', en: 'PICKERS' }];
const ACCENTS = [{ value: '#fffa00', name: '信号黄' }, { value: '#00f5a0', name: '薄荷绿' }, { value: '#20b8ff', name: '天青' }, { value: '#ff7a1a', name: '警示橙' }];

/** 设计系统预览页（只在开发时用）：?page=home|settings|parts|pickers，加 ?still 关掉动效方便截图。 */
export function Gallery({ page: initial }: { page: string }) {
  const [page, setPage] = useState(initial), [pinned, setPinned] = useState(false);
  const titleBar = <TitleBar name="单轨" tabs={TABS} active={page} onTab={setPage}>
    <StatusTag kind="focus" label="沿 Python 往下学" time="47:12" />
    <WindowButtons pinned={pinned} maximized={false} onPin={() => setPinned(!pinned)} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  const statusBar = <StatusBar
    left={<Button size="sm">快捷活动</Button>}
    right={<><span>主线 ✓</span><span>支线 ·</span></>} />;
  return <Frame titleBar={titleBar} statusBar={statusBar}>
    {page === 'home' && <HomeMock />}
    {page === 'settings' && <SettingsMock />}
    {page === 'parts' && <PartsMock />}
    {page === 'pickers' && <PickersMock />}
  </Frame>;
}

// 新建项目时轮流用这几个颜色（真实软件里由调用方决定）
const PALETTE = ['#c0392b', '#16a085', '#8e44ad', '#d35400'];

/** 项目选择、标签选择：普通、小号、不可用，以及卡头「记到」那一行的 flat 样式。 */
function PickersMock() {
  const [projects, setProjects] = useState<ProjectOption[]>([{ name: '未分类', color: '#a3a39e' }, { name: '求职', color: '#ff5a3c' },
    { name: '学习', color: '#00b4ff' }, { name: '生活', color: '#d9a400' }, { name: '运动', color: '#00c389' }]);
  const [known, setKnown] = useState(['408', 'python', '面试', '户外']);
  const [project, setProject] = useState('学习'), [tags, setTags] = useState(['408']);
  const [flatProject, setFlatProject] = useState('求职'), [flatTags, setFlatTags] = useState<string[]>([]);
  const createProject = (name: string) => setProjects(list => [...list, { name, color: PALETTE[list.length % PALETTE.length] }]);
  const createTag = (tag: string) => setKnown(list => [...list, tag]);
  return <SplitLayout nav={<SideNav en="PICKERS" cn="选择器" items={[{ id: 'p', no: '01', cn: '项目和标签', en: 'PROJECT · TAG' }]} active="p" onSelect={() => {}} />}>
    <PanelHeader no="01" en="PROJECT · TAG" cn="项目和标签" desc="点开列出已有的，输入就筛选；没有就新建。上下键选，回车确定，Esc 收起。" />
    <Group cn="计时条和表单" en="FORM">
      <Row title="项目" desc="150×34，左边是项目色点"><ProjectPicker id="pk-project" value={project} options={projects} onChange={setProject} onCreate={createProject} /></Row>
      <Row title="小号" desc="128×28，用在列表行里"><ProjectPicker small value={project} options={projects} onChange={setProject} onCreate={createProject} /></Row>
      <Row title="不可用" desc="正在做卡时"><ProjectPicker disabled value="求职" options={projects} onChange={() => {}} /></Row>
      <Row title="标签" desc="回车、空格、逗号新建；输入框为空时退格去掉最后一个"><TagPicker id="pk-tags" value={tags} options={known} onChange={setTags} onCreate={createTag} /></Row>
    </Group>
    <Group cn="卡头「记到」那一行" en="FLAT">
      <Row title="flat" desc="和这一行字一个样子，点一下就地改">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '330 14px/1 var(--f-cn)', color: 'var(--mute)' }}>记到
          <ProjectPicker id="pk-flat-project" flat value={flatProject} options={projects} onChange={setFlatProject} onCreate={createProject} />
          <TagPicker id="pk-flat-tags" flat value={flatTags} options={known} onChange={setFlatTags} onCreate={createTag} /></span>
      </Row>
    </Group>
  </SplitLayout>;
}

function HomeMock() {
  const [fx, setFx] = useState<'' | 'wipe' | 'cut'>('');
  return <section className="g-card" onDoubleClick={() => setFx('wipe')} onContextMenu={e => { e.preventDefault(); setFx('cut'); }}>
    <Topo running />
    <ScanLine />
    <TagStrip no="01" of="/03" />
    <div className="g-in" id="g-in">
      <div className="g-head"><TrackMark /><b>找工作</b><span className="g-meta">时间盒<em>· 目标 60 分钟</em></span></div>
      <div className="g-hero"><Corners><h1 className="g-title"><span className="ln">沿 <span className="hl">Python</span> 往下学</span><span className="ln">1 小时</span></h1></Corners></div>
      <VBars className="g-meter" filled={47} state="run" />
      <div className="g-foot">
        <div className="g-acts">
          <ActionButton primary cn="完成" en="COMPLETE" icon="check" />
          <ActionButton cn="缩小" en="SHRINK" icon="shrink" />
          <ActionButton cn="再抽一张" en="NEXT" icon="swap" />
        </div>
        <Readout state="run" stateCn="进行中" stateEn="RUNNING" digits="47:12" />
      </div>
    </div>
    {fx === 'wipe' && <Wipe no="02" meta="支线 · 结果卡" title="查一下几台服务器有没有被攻击" onCovered={() => {}} onDone={() => setFx('')} />}
    {fx === 'cut' && <CutIn cn={<>目标<em>达成</em></>} en="OBJECTIVE COMPLETE" sub="已用 60:00 // 继续计时会标出超出多少" dim={document.getElementById('g-in')} onDone={() => setFx('')} />}
  </section>;
}

function SettingsMock() {
  const [sec, setSec] = useState('timer'), [on, setOn] = useState(true), [v, setV] = useState(60), [seg, setSeg] = useState(0);
  const [dd, setDd] = useState(0), [accent, setAccent] = useState('#fffa00'), [hk, setHk] = useState('Ctrl+Alt+Shift+R');
  const items = [['card', '出卡', 'DEAL'], ['degrade', '降级', 'DEGRADE'], ['idea', '想法与回顾', 'IDEAS'], ['timer', '计时', 'TIMER'],
    ['acts', '快捷活动与休息池', 'LISTS'], ['look', '外观', 'APPEARANCE'], ['keys', '快捷键', 'HOTKEYS'], ['data', '窗口与数据', 'DATA'], ['about', '关于', 'ABOUT']]
    .map(([id, cn, en], i) => ({ id, cn, en, no: String(i + 1).padStart(2, '0') }));
  return <SplitLayout nav={<SideNav en="SETTINGS" cn="设置" items={items} active={sec} onSelect={setSec}
    foot={<><Emblem /><div><b>单轨</b><span>v0.1.0</span></div></>} />}>
    <PanelHeader no="04" en="TIMER" cn="计时" desc="计时一直开着，任何时刻只有一项活动在计时。下面的数字都是初始值，用过一段时间后再校准。" />
    <Group cn="基本" en="BASIC">
      <Row title="待机名称" desc="亮卡到点开始之间记成这个名字"><TextInput defaultValue="待机" style={{ width: 200 }} /></Row>
      <Row title="日边界" desc="几点算新的一天"><Dropdown value={dd} onChange={setDd} options={[0, 1, 2, 3, 4, 5, 6].map(h => ({ value: h, label: `凌晨 ${h}:00` }))} /></Row>
      <Row title="长时间提醒" desc="同一活动超过这个时长，轻提醒确认一下"><Slider value={v} min={30} max={480} step={30} unit="MIN" onChange={setV} /></Row>
      <Row title="提醒方式"><Segmented value={seg} onChange={setSeg} options={[{ value: 0, label: '系统通知' }, { value: 1, label: '应用内' }, { value: 2, label: '声音', disabled: true, badge: '开发中' }]} /></Row>
      <Row title="开机自启" desc="设置里可以关，默认开"><Switch checked={on} onChange={setOn} /></Row>
    </Group>
    <Group cn="外观与快捷键" en="LOOK & KEYS">
      <Row title="强调色"><Swatch options={ACCENTS} value={accent} onChange={setAccent} /></Row>
      <Row title="快速记录条" desc={<>按 <Keycap keys="Ctrl+Alt+Shift+R" small /> 唤出</>}><HotkeyInput value={hk} onChange={setHk} /></Row>
      <Row title="期限"><DateTimeInput value="2026-10-28T10:00:00.000Z" onChange={() => {}} /></Row>
      <Row title="危险操作"><Button>导出</Button><Button tone="ink">选择目录</Button><Button tone="danger">清空今天</Button></Row>
    </Group>
  </SplitLayout>;
}

function PartsMock() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null), [dlg, setDlg] = useState(false), [text, setText] = useState('写一行，Shift+Enter 换行');
  return <div className="g-sheet" onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
    <div className="g-mini">
      <TagStrip mini no="01" />
      <div className="g-mini-l"><Topo cell={8} alpha={.85} /><span className="k">找工作 · 时间盒 · 目标 60 分钟</span><b>沿 <span className="hl">Python</span> 往下学 1 小时</b><MiniBars filled={23} /></div>
      <div className="g-mini-r"><div style={{ display: 'grid', gap: 7, marginRight: 8 }}><span className="k">RUNNING</span><span className="g-mini-time">47:12</span></div>
        <button className="g-mbtn go" type="button"><Icon name="check" /></button><button className="g-mbtn" type="button"><Icon name="expand" /></button></div>
    </div>
    <div className="g-tray">
      <ActTile icon="sleep" name="睡觉" en="SLEEP" keys="1" onClick={() => {}} />
      <ActTile icon="wc" name="厕所" en="RESTROOM" keys="2" pressed onClick={() => {}} />
      <AddTile onClick={() => setDlg(true)} />
    </div>
    <div style={{ display: 'grid', gap: 12, width: 420 }}>
      <TextArea autoGrow value={text} onChange={e => setText(e.target.value)} />
      <TextInput placeholder="需要什么资源，例如空闲服务器" />
      <div style={{ display: 'flex', gap: 8 }}><Chip label="#服务器" on onClick={() => {}} /><Chip label="#学习" onRemove={() => {}} /><Chip label="阻塞" /></div>
      <div style={{ display: 'flex', gap: 10 }}><Button onClick={() => setDlg(true)}>打开对话框</Button><Button tone="ink">右键这里看菜单</Button></div>
    </div>
    <Emblem className="g-emb" strokeWidth={1.6} />
    <ToastStack onClose={() => {}} items={[{ id: '1', en: 'DEADLINE', title: '待办期限提醒', text: '「查服务器」还有 1 小时到期。' }]} />
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} items={[
      { label: '开始', keys: 'Space', onSelect: () => {} }, { label: '缩小成悬浮小窗', keys: 'M', onSelect: () => {} }, 'divider',
      { label: '窗口置顶', checked: true, onSelect: () => {} }, { label: '今天不再出卡', onSelect: () => {}, disabled: true }]} />}
    {dlg && <Dialog en="TIMEBOX" title="还差 15 分钟" onClose={() => setDlg(false)}
      footer={<><Button onClick={() => setDlg(false)}>沿方向继续</Button><Button tone="ink" onClick={() => setDlg(false)}>就到这</Button></>}>
      选「就到这」照样算完成，按实际时长记录。</Dialog>}
  </div>;
}
