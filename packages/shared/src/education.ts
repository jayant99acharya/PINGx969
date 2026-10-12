import type { DegreeLevel } from './schemas/job';

export const DEGREE_RANK: Record<DegreeLevel, number> = {
  none: 0,
  highschool: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  phd: 5,
};

export const DEGREE_RE =
  /\b(Bachelor(?:'s|s)?(?:\s+of\s+[A-Z][a-z]+(?:\s+in)?)?|Master(?:'s|s)?(?:\s+of\s+[A-Z][a-z]+(?:\s+in)?)?|B\.\s?S\.?c?|B\.\s?A\.?|BSc|BS|BA|BEng|B\.\s?Eng\.?|B\.?\s?Tech\.?|B\.E\.?|M\.\s?S\.?c?|MSc|MS|MA|MEng|M\.\s?Eng\.?|M\.?\s?Tech\.?|M\.A\.|MBA|Ph\.?\s?D\.?|Doctor(?:ate)?(?:\s+of\s+[A-Z][a-z]+)?|Associate(?:'s)?(?:\s+of\s+[A-Z][a-z]+)?|A\.A\.S?|A\.S\.|High School Diploma|GED)(?![A-Za-z])/;

export function degreeLevel(text: string): DegreeLevel {
  const t = text;
  if (/\b(ph\.?\s?d|doctor(ate)?|d\.?phil)\b/i.test(t)) return 'phd';
  if (/\b(master|m\.\s?s\.?c?|msc|m\.?eng|mba|m\.a\.|m\.?tech)\b|\bMS\b|\bMA\b/i.test(t)) return 'master';
  if (/\b(bachelor|b\.\s?s\.?c?|bsc|b\.?eng|b\.?tech|b\.a\.|b\.e\.|undergraduate degree|4-year degree|four-year degree)\b|\bBS\b|\bBA\b/i.test(t))
    return 'bachelor';
  if (/\b(associate(?:'s)? degree|a\.a\.s?|a\.s\.)\b/i.test(t)) return 'associate';
  if (/\b(high school|ged|secondary school|hsc|ssc|12th|10th|intermediate|a-levels?|cbse|icse)\b/i.test(t)) return 'highschool';
  return 'none';
}
