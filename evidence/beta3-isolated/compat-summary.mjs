import { readFile } from 'node:fs/promises';
const r = JSON.parse(await readFile('evidence/beta3-isolated/compat-results.json', 'utf8'));
for (const [k, v] of Object.entries(r)) console.log(k, JSON.stringify({ ok: v.ok, pending: v.pendingJournals, craft: v.craft && { commit: v.craft.commit ?? v.craft.secondCommit, plan: v.craft.plan },
  v025: v.v025 && { opened: v.v025.opened, journals: v.v025.journals, added: v.v025.historyAddedByRecovery, record: v.v025.record, kept: v.v025.loggedRecordKept, title: v.v025.settingsTitleScale, merged: v.v025.mergedRecord },
  beta3: v.beta3 && { opened: v.beta3.opened, journals: v.beta3.journals, record: v.beta3.record, cards: v.beta3.cardsForRecord, qb: v.beta3.quickbarHistory } }));
