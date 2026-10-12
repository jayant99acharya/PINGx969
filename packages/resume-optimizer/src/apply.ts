import { type Change, type ResumeData, findSkills } from '@pingx969/shared';

/** Apply accepted, unblocked, non-informational changes to a copy of the resume data. */
export function applyChanges(original: ResumeData, changes: Change[]): ResumeData {
  const data: ResumeData = structuredClone(original);
  const active = changes.filter((c) => c.accepted && !c.blocked && !c.informational);
  const order: Change['kind'][] = ['skills_reordered', 'skill_added', 'bullet_rephrased', 'suggestion', 'bullets_reordered', 'summary_generated', 'summary_rephrased'];
  active.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  const findBullet = (c: Change) => {
    const list = c.target.experienceId
      ? data.experience.find((e) => e.id === c.target.experienceId)?.bullets
      : data.projects.find((p) => p.id === c.target.projectId)?.bullets;
    return list?.find((b) => b.id === c.target.bulletId);
  };

  for (const c of active) {
    switch (c.kind) {
      case 'skills_reordered': {
        const g = data.skills.find((x) => x.id === c.target.skillGroupId);
        if (g && Array.isArray(c.after)) {
          // Only a permutation of the current items is allowed.
          const cur = new Set(g.items.map((i) => i.toLowerCase()));
          if (c.after.length === g.items.length && c.after.every((i) => cur.has(i.toLowerCase()))) g.items = [...c.after];
        }
        break;
      }
      case 'skill_added': {
        const g = data.skills.find((x) => x.id === c.target.skillGroupId) ?? data.skills[0];
        if (g && typeof c.after === 'string') {
          const canon = findSkills(c.after)[0]?.name;
          const exists = g.items.some((i) => i.toLowerCase() === c.after!.toString().toLowerCase() || (canon && findSkills(i)[0]?.name === canon));
          if (!exists) g.items.push(c.after);
        }
        break;
      }
      case 'bullet_rephrased':
      case 'suggestion': {
        const b = findBullet(c);
        if (b && typeof c.after === 'string') b.text = c.after;
        break;
      }
      case 'bullets_reordered': {
        const list = c.target.experienceId
          ? data.experience.find((e) => e.id === c.target.experienceId)
          : data.projects.find((p) => p.id === c.target.projectId);
        if (list && c.target.order) {
          const byId = new Map(list.bullets.map((b) => [b.id, b]));
          const next = c.target.order.map((id) => byId.get(id)).filter(Boolean) as typeof list.bullets;
          if (next.length === list.bullets.length) list.bullets = next;
        }
        break;
      }
      case 'summary_generated':
      case 'summary_rephrased':
        if (typeof c.after === 'string') data.summary.text = c.after;
        break;
    }
  }
  return data;
}

export function unfilledPlaceholders(changes: Change[]): Change[] {
  return changes.filter((c) => c.accepted && !c.blocked && typeof c.after === 'string' && /\[[^\]]{2,80}\]/.test(c.after));
}
