import type { Card } from '../card/card';
import type { Project } from '../project/project';
import { inBackpack } from '../project/project';

export type GuideKind = 'firstProject' | 'setMain' | 'splitMain' | 'allDone';
export function guide(cards: Card[], projects: Project[]): GuideKind {
  const active = projects.filter(inBackpack), main = active.find(project => project.slot === '主线');
  if (active.length === 0 && !cards.some(card => card.project_id === null)) return 'firstProject';
  if (!main) return 'setMain';
  if (!cards.some(card => card.project_id === main.id)) return 'splitMain';
  return 'allDone';
}
