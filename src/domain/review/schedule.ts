export interface Review {
  id: string; period: string; status: '未开始' | '进行中' | '已完成' | '已被取代'; step: string;
  done?: ('recap' | 'newIdeas' | 'arena' | 'coldPick' | 'bet')[];
  started_at?: string | null; completed_at?: string | null; added_idea_ids?: string[];
  bet_task_ids?: string[]; bet_done_ids?: string[]; cold_duel?: { left: string; right: string } | null;
  timer_segment_id?: string | null;
}
export interface ReviewDue { period: string; resumeStep: string; betDue: boolean }
export function isoWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear(), first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - first.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
function currentPeriod(day: string, firstDay: string, weekday: number, reviews: Review[]): string | null {
  const week = isoWeek(day);
  if (week <= isoWeek(firstDay)) return null;
  // An explicitly started/completed review in this week already owns the period.
  if (reviews.some(review => review.period === week)) return week;
  const due = new Date(`${day}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - ((due.getUTCDay() || 7) - weekday + 7) % 7);
  const period = isoWeek(due.toISOString().slice(0, 10));
  return period > isoWeek(firstDay) ? period : null;
}
/** Keep the last due period until the next one becomes due, including ISO year changes. */
export function dueReview(day: string, firstDay: string, weekday: number, reviews: Review[], betDue: boolean): ReviewDue | null {
  const period = currentPeriod(day, firstDay, weekday, reviews);
  if (!period) return null;
  const review = reviews.find(item => item.period === period);
  if (review?.status === '已完成' || review?.status === '已被取代') return null;
  return { period, resumeStep: review?.step ?? 'recap', betDue };
}

/** Persist only changed rows: one current period, with older unfinished periods superseded. */
export function reviewUpdates(day: string, firstDay: string, weekday: number, reviews: Review[]): Review[] {
  const period = currentPeriod(day, firstDay, weekday, reviews);
  if (!period) return [];
  const changes: Review[] = reviews.filter(review => review.period < period && (review.status === '未开始' || review.status === '进行中'))
    .map(review => ({ ...review, status: '已被取代' }));
  if (!reviews.some(review => review.period === period)) changes.push({ id: period, period, status: '未开始', step: 'recap' });
  return changes;
}
