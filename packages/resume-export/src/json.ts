import type { ResumeData } from '@pingx969/shared';

/** Convert to the JSON Resume schema (https://jsonresume.org/schema). */
export function toJsonResume(data: ResumeData) {
  const [city, region] = data.personal.location.split(/,\s*/);
  return {
    basics: {
      name: data.personal.name,
      label: data.personal.headline || data.experience[0]?.title || '',
      email: data.personal.email,
      phone: data.personal.phone,
      summary: data.summary.text,
      location: { city: city ?? '', region: region ?? '' },
      profiles: data.links.filter((l) => l.kind === 'linkedin' || l.kind === 'github').map((l) => ({ network: l.kind === 'linkedin' ? 'LinkedIn' : 'GitHub', url: l.url })),
      url: data.links.find((l) => l.kind === 'website' || l.kind === 'portfolio')?.url ?? '',
    },
    work: data.experience.map((e) => ({ name: e.company, position: e.title, location: e.location, startDate: e.startDate, endDate: e.endDate === 'present' ? undefined : e.endDate, highlights: e.bullets.map((b) => b.text) })),
    education: data.education.map((e) => ({ institution: e.institution, studyType: e.degree, area: e.field, startDate: e.startDate, endDate: e.endDate, score: e.gpa })),
    skills: data.skills.map((g) => ({ name: g.category ?? 'Skills', keywords: g.items })),
    projects: data.projects.map((p) => ({ name: p.name, description: p.description, url: p.url, highlights: p.bullets.map((b) => b.text), keywords: p.technologies })),
    certificates: data.certifications.map((c) => ({ name: c.name, issuer: c.issuer, date: c.date })),
  };
}
