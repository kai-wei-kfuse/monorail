export interface Review { id: string; period: string; status: '未开始' | '进行中' | '已完成'; step: string }
export interface ReviewDue { period: string; resumeStep: string; betDue: boolean }
export function isoWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear(), first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - first.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export function dueReview(day: string, firstDay: string, weekday: number, reviews: Review[], betDue: boolean): ReviewDue | null {
  const period = isoWeek(day), review = reviews.find(item => item.period === period);
  if (review?.status === '已完成' || isoWeek(firstDay) === period) return null;
  if ((new Date(`${day}T00:00:00Z`).getUTCDay() || 7) < weekday && !review) return null;
  return { period, resumeStep: review?.step ?? 'recap', betDue };
}
