import { describe, expect, it } from 'vitest';
import { canonicalSkill, expandImplied, extractNumbers, findDateRanges, findSkills, mergeProfile, emptyProfile, parseSingleDate, stem, totalMonths, degreeLevel } from '../src';

describe('dates', () => {
  it('parses common resume date formats', () => {
    expect(parseSingleDate('Mar 2021')).toEqual({ year: 2021, month: 3 });
    expect(parseSingleDate('September 2019')).toEqual({ year: 2019, month: 9 });
    expect(parseSingleDate('03/2020')).toEqual({ year: 2020, month: 3 });
    expect(parseSingleDate('2018')).toMatchObject({ year: 2018, yearOnly: true });
    expect(parseSingleDate('Present')).toBe('present');
    expect(parseSingleDate('nonsense')).toBeNull();
  });

  it('finds date ranges with different separators', () => {
    expect(findDateRanges('Engineer | Jan 2020 – Present').map((r) => r.text)).toEqual(['Jan 2020 – Present']);
    expect(findDateRanges('2016 - 2018 and 05/2019 to 06/2021')).toHaveLength(2);
  });

  it('counts overlapping roles once', () => {
    const now = new Date('2024-01-15');
    expect(totalMonths([{ start: '2020-01', end: '2020-12' }], now)).toBe(12);
    expect(totalMonths([{ start: '2020-01', end: '2020-12' }, { start: '2020-06', end: '2021-05' }], now)).toBe(17);
    expect(totalMonths([{ start: '2023-01', end: 'present' }], now)).toBe(13);
  });
});

describe('taxonomy', () => {
  it('finds skills with aliases and canonicalizes them', () => {
    expect(findSkills('Built services with Postgres, k8s and Node.js').map((m) => m.name)).toEqual(['PostgreSQL', 'Kubernetes', 'Node.js']);
    expect(canonicalSkill('postgres')).toBe('PostgreSQL');
    expect(canonicalSkill('React.js')).toBe('React');
    expect(canonicalSkill('Underwater basket weaving')).toBe('Underwater basket weaving');
  });

  it('avoids false positives for ambiguous names', () => {
    expect(findSkills('We will go to the office').map((m) => m.name)).not.toContain('Go');
    expect(findSkills('Languages: Python, Go, C, R').map((m) => m.name)).toEqual(['Python', 'Go', 'C', 'R']);
    expect(findSkills('Our R&D team').map((m) => m.name)).not.toContain('R');
    expect(findSkills('each node in the cluster').map((m) => m.name)).not.toContain('Node.js');
    expect(findSkills('C++ and C# developer').map((m) => m.name)).toEqual(['C++', 'C#']);
  });

  it('expands implications transitively', () => {
    const implied = expandImplied(['Next.js', 'PostgreSQL']);
    expect(implied.get('React')).toBe('Next.js');
    expect(implied.get('JavaScript')).toBe('Next.js');
    expect(implied.get('SQL')).toBe('PostgreSQL');
  });
});

describe('text', () => {
  it('extracts metrics for fabrication checks', () => {
    expect(extractNumbers('Cut cost by 30% for $2.5M budget serving 2M users, 3x faster')).toEqual(['30%', '$2.5m', '2m', '3x']);
  });
  it('stems consistently', () => {
    expect(stem('building')).toBe(stem('builds'));
    expect(stem('optimized')).toBe(stem('optimizing'));
  });
  it('detects degree levels', () => {
    expect(degreeLevel('B.S., Computer Science')).toBe('bachelor');
    expect(degreeLevel("Master's degree in Statistics")).toBe('master');
    expect(degreeLevel('PhD')).toBe('phd');
    expect(degreeLevel('Bootcamp certificate')).toBe('none');
  });
});

describe('profile merge', () => {
  it('deep merges and ignores prototype pollution', () => {
    const p = mergeProfile(emptyProfile(), JSON.parse('{"personal":{"phone":"123"},"__proto__":{"polluted":true}}'));
    expect(p.personal.phone).toBe('123');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
