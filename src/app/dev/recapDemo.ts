// 回看预览的演示数据（只在开发时用）：照原型 recap-prototype.html 的作息模板，以「今天」为终点往前生成一年多的计时条目，
// 加几张完成的卡和「做到哪了」。固定种子，每次打开都一样。
import type { Card } from '../../domain/card/card';
import type { Task } from '../../domain/task/task';
import type { TimeEntry } from '../../domain/timeline/entry';

type Act = [description: string, project: string, tags: string[], card: string | null, kind?: '插入'];
const ACT: Record<string, Act> = {
  ds: ['[408] 数据结构 · 图与最短路', '学习', ['408'], 'c408'], co: ['[408] 计组 · Cache 映射与习题', '学习', ['408'], 'c408'],
  os: ['[408] 操作系统 · 进程同步', '学习', ['408', '刷题'], 'c408'], wrong: ['408 错题整理', '学习', ['408', '复盘'], 'c408'],
  apply: ['投递 · 字节 / 米哈游 / 网易', '求职', ['投递'], 'cjob'], cv: ['简历修改 v4', '求职', ['简历'], 'cjob'],
  mock: ['模拟面试 · 八股 + 项目追问', '求职', ['面试'], 'calgo'], lc: ['LeetCode 每日两题', '求职', ['刷题', 'python'], 'calgo'],
  py: ['python 爬虫：岗位数据抓取', '工作', ['python'], 'cdev'], mail: ['回邮件 / 群消息', '工作', [], null],
  cook: ['做饭', '生活', ['做饭'], null], meal: ['吃饭', '生活', [], null], clean: ['收拾房间 / 洗衣服', '生活', [], null],
  run: ['夜跑 5km', '运动', ['健身'], null], gym: ['力量训练', '运动', ['健身'], null], hike: ['爬山 · 凤凰岭', '运动', ['户外'], null],
  game: ['打游戏', '娱乐', [], null], video: ['看纪录片', '娱乐', [], null],
  wc: ['上厕所', '生活', [], null, '插入'], parcel: ['取快递', '生活', [], null, '插入'],
};
const WEEKDAY: [string[], number, number][] = [[['ds', 'co', 'os'], 80, 120], [['ds', 'co', 'wrong'], 60, 100], [['meal', 'cook'], 35, 55],
  [['apply', 'cv', 'lc', 'mock'], 50, 90], [['py', 'mail'], 60, 110], [['lc', 'wrong', 'mock'], 40, 80], [['cook', 'meal'], 40, 60],
  [['run', 'gym', 'clean'], 35, 65], [['game', 'video'], 30, 70]];
const WEEKEND: [string[], number, number][] = [[['clean'], 50, 90], [['hike', 'gym', 'run'], 120, 210], [['meal', 'cook'], 40, 70],
  [['wrong', 'ds'], 60, 100], [['apply', 'cv', 'mock'], 40, 80], [['game', 'video'], 60, 120], [['video', 'game'], 40, 70]];

export const DEMO_TASKS: Task[] = [
  { id: 't408', name: '408 考研复习', slot: '主线', slot_index: 1, status: '进行中', created_at: '2025-09-01T00:00:00.000Z', bet_ends_at: null, default_project: '学习' },
  { id: 'tjob', name: '秋招投递', slot: '支线', slot_index: 1, status: '进行中', created_at: '2025-09-01T00:00:00.000Z', bet_ends_at: null, default_project: '求职' },
  { id: 'talgo', name: '算法面试准备', slot: '支线', slot_index: 2, status: '进行中', created_at: '2025-09-01T00:00:00.000Z', bet_ends_at: null, default_project: '求职' },
  { id: 'tdev', name: '单轨 v0.3 开发', slot: '支线', slot_index: 3, status: '进行中', created_at: '2025-09-01T00:00:00.000Z', bet_ends_at: null, default_project: '工作' },
];
const card = (id: string, task: string, content: string, extra: Partial<Card> = {}): Card => ({
  id, source_record_id: null, content, created_at: '2025-09-01T00:00:00.000Z', due_at: null, blocking: false, task_id: task, project: null, tags: [],
  status: '进行中', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null,
  skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '', ...extra } as Card);

/** 以 now 为终点的演示数据：约 400 天的计时条目、进行中的四张卡、最近两周完成的卡和笔记。 */
export function recapDemo(now = Date.now()) {
  let seed = 20261108;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)], span = (a: number, b: number) => Math.round((a + rnd() * (b - a)) / 5) * 5;
  const entries: TimeEntry[] = [];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let n = 0;
  const push = (day: Date, startMin: number, min: number, key: string, project?: string) => {
    const [desc, p, tags, cardId, kind] = ACT[key] ?? [key, project ?? key, [], null];
    const s = day.getTime() + startMin * 60_000, e = s + min * 60_000;
    if (min <= 0 || s >= now) return;
    entries.push({ id: `demo-${String(++n).padStart(5, '0')}`, started_at: new Date(s).toISOString(), ended_at: new Date(Math.min(e, now - 60_000)).toISOString(),
      description: desc, project: project ?? p, tags, card_id: cardId, kind: kind ?? '普通', source: '计时', updated_at: new Date(e).toISOString() });
  };
  for (let back = 400; back >= 0; back--) {
    const day = new Date(today); day.setDate(day.getDate() - back);
    const weekend = [0, 6].includes(day.getDay());
    let t = span(440, 500);
    push(day, 0, t - 20, '睡觉', '睡眠');
    for (const [opts, lo, hi] of weekend ? WEEKEND : WEEKDAY) {
      if (rnd() < .4) { const g = span(10, 35); push(day, t, g, '待机', '待机'); t += g; }
      const key = pick(opts), len = span(lo, hi);
      if (!ACT[key][4] && rnd() < .25 && len > 50) {
        const a = Math.round(len * .5 / 5) * 5, aw = pick(['wc', 'parcel']), al = span(5, 15);
        push(day, t, a, key); push(day, t + a, al, aw); push(day, t + a + al, len - a, key);
      } else push(day, t, len, key);
      t += len + (rnd() < .5 ? 0 : 5);
    }
    if (t < 1380) push(day, t, 1380 - t, '待机', '待机');
  }
  const ago = (d: number, h = 21) => { const x = new Date(today); x.setDate(x.getDate() - d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const cards: Card[] = [
    card('c408', 't408', '[408] 操作系统 · 进程同步', { progress_note: 'PV 操作经典题还剩读者写者，明早继续', progress_noted_at: ago(0, 8) }),
    card('cjob', 'tjob', '投递 · 字节 / 米哈游 / 网易', { progress_note: '第一批投完，等笔试通知；简历要补一段性能优化数据', progress_noted_at: ago(3) }),
    card('calgo', 'talgo', 'LeetCode 动态规划专题', { progress_note: '模拟面试里「项目难点」答得太散，整理 STAR 版本', progress_noted_at: ago(5) }),
    card('cdev', 'tdev', '单轨回看原型 · 图表部分', { progress_note: '柱状图 + 环形图出来了，明细列表还要做二级展开', progress_noted_at: ago(1) }),
    ...([[1, '[408] 数据结构 · 图与最短路', 't408'], [2, '模拟面试 2 场 · 复盘问题清单', 'talgo'], [4, 'python 爬虫：岗位数据抓取 v1', 'tdev'],
      [6, '[408] 计网 · 传输层', 't408'], [8, '投递 12 家 · 互联网第一批', 'tjob'], [9, '[408] 计组 · 第三章存储系统', 't408'],
      [11, '简历修改 v3 · 补项目量化', 'tjob'], [12, '[408] 数据结构 · 树与二叉树习题', 't408']] as const)
      .map(([d, content, task], i) => card(`done${i}`, task, content, { status: '已完成', completed_at: ago(d, 20), completed_day: null,
        completed_track: task === 't408' ? '主线' : '支线', progress_note: i % 3 === 0 ? '这一块做完了，下周接着往下' : '', progress_noted_at: i % 3 === 0 ? ago(d, 20) : null })),
  ];
  // 完成的卡挂上几条自己的计时条目，「用时」才有值
  cards.filter(c => c.status === '已完成').forEach((c, i) => {
    const s = Date.parse(c.completed_at!) - (90 + i * 20) * 60_000;
    entries.push({ id: `demo-done-${i}`, started_at: new Date(s).toISOString(), ended_at: new Date(Date.parse(c.completed_at!) - 60_000).toISOString(),
      description: c.content, project: DEMO_TASKS.find(t => t.id === c.task_id)!.default_project!, tags: [], card_id: c.id, kind: '普通', source: '计时', updated_at: c.completed_at! });
  });
  return { entries, cards, tasks: DEMO_TASKS, firstUsedDay: new Date(today.getTime() - 400 * 86_400_000).toISOString().slice(0, 10) };
}
