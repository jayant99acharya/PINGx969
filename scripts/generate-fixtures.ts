/**
 * Generates realistic resume fixtures in every supported format (DOCX, PDF, TXT, MD, JSON)
 * plus job descriptions. Run with: npm run fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { BACKEND_JD, FRONTEND_JD, RESUME } from './fixture-data';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'fixtures');

export async function buildDocx(): Promise<Buffer> {
  const heading = (text: string) =>
    new Paragraph({
      spacing: { before: 200, after: 80 },
      border: { bottom: { color: '808080', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      children: [new TextRun({ text, bold: true, allCaps: false, size: 24, color: '1F3864' })],
    });
  const bullet = (text: string) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun(text)] });
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: RESUME.name.toUpperCase(), bold: true, size: 44 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: RESUME.contact.join(' | '), size: 19 })] }),
    heading('SUMMARY'),
    new Paragraph({ children: [new TextRun(RESUME.summary)] }),
    heading('EXPERIENCE'),
  ];
  for (const e of RESUME.experience) {
    children.push(
      new Paragraph({
        spacing: { before: 120 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: e.title, bold: true }),
          new TextRun({ text: ` | ${e.company} | ${e.location}` }),
          new TextRun({ children: [new Tab(), e.dates], italics: true }),
        ],
      }),
    );
    for (const b of e.bullets) children.push(bullet(b));
  }
  children.push(heading('EDUCATION'));
  children.push(
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: RESUME.education.school, bold: true }),
        new TextRun({ text: ` | ${RESUME.education.degree}` }),
        new TextRun({ children: [new Tab(), RESUME.education.dates] }),
      ],
    }),
  );
  children.push(heading('SKILLS'));
  for (const [cat, items] of RESUME.skills) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${cat}: `, bold: true }), new TextRun(items)] }));
  }
  children.push(heading('PROJECTS'));
  for (const p of RESUME.projects) {
    children.push(new Paragraph({ children: [new TextRun({ text: p.name, bold: true }), new TextRun(` | ${p.url}`)] }));
    for (const b of p.bullets) children.push(bullet(b));
  }
  children.push(heading('CERTIFICATIONS'));
  for (const c of RESUME.certifications) children.push(new Paragraph({ children: [new TextRun(c)] }));

  const doc = new Document({
    creator: 'Jane Doe',
    title: 'Jane Doe Resume',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 720, right: 864, bottom: 720, left: 864 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function buildPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Jane Doe Resume');
  const page = pdf.addPage([612, 792]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const L = 54;
  const R = 612 - 54;
  const W = R - L;
  let y = 792 - 60;
  const body = 10;
  const lh = 13;
  const text = (t: string, x: number, f: PDFFont, s: number) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0.1, 0.1, 0.1) });
  const center = (t: string, f: PDFFont, s: number) => text(t, (612 - f.widthOfTextAtSize(t, s)) / 2, f, s);
  center(RESUME.name.toUpperCase(), bold, 20);
  y -= 18;
  center(RESUME.contact.join(' | '), reg, 9.5);
  y -= 22;
  const heading = (t: string) => {
    text(t, L, bold, 11);
    page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
    y -= 18;
  };
  const bullet = (t: string) => {
    const lines = wrap(t, reg, body, W - 14);
    lines.forEach((ln, i) => {
      if (i === 0) text('•', L + 2, reg, body);
      text(ln, L + 14, reg, body);
      y -= lh;
    });
  };
  heading('SUMMARY');
  for (const ln of wrap(RESUME.summary, reg, body, W)) {
    text(ln, L, reg, body);
    y -= lh;
  }
  y -= 8;
  heading('EXPERIENCE');
  for (const e of RESUME.experience) {
    text(e.title, L, bold, body);
    const rest = ` | ${e.company} | ${e.location}`;
    text(rest, L + bold.widthOfTextAtSize(e.title, body), reg, body);
    text(e.dates, R - ital.widthOfTextAtSize(e.dates, body), ital, body);
    y -= lh;
    for (const b of e.bullets) bullet(b);
    y -= 5;
  }
  y -= 3;
  heading('EDUCATION');
  text(RESUME.education.school, L, bold, body);
  text(` | ${RESUME.education.degree}`, L + bold.widthOfTextAtSize(RESUME.education.school, body), reg, body);
  text(RESUME.education.dates, R - reg.widthOfTextAtSize(RESUME.education.dates, body), reg, body);
  y -= lh + 8;
  heading('SKILLS');
  for (const [cat, items] of RESUME.skills) {
    text(`${cat}: `, L, bold, body);
    text(items, L + bold.widthOfTextAtSize(`${cat}: `, body), reg, body);
    y -= lh;
  }
  y -= 8;
  heading('PROJECTS');
  for (const p of RESUME.projects) {
    text(p.name, L, bold, body);
    text(` | ${p.url}`, L + bold.widthOfTextAtSize(p.name, body), reg, body);
    y -= lh;
    for (const b of p.bullets) bullet(b);
  }
  y -= 8;
  heading('CERTIFICATIONS');
  for (const c of RESUME.certifications) {
    text(c.replace('–', '-'), L, reg, body);
    y -= lh;
  }
  return pdf.save();
}

/**
 * A designed, table-style PDF (like many template-builder resumes): letter-spaced coloured name,
 * bordered education table with a header row, "Label | items" skills table with wrapped rows,
 * vector-dot bullets and a clickable link. Used to test parsing and in-place PDF editing.
 */
export async function buildTablePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Alex Rivera Resume');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0.1, 0.3, 0.65);
  const ink = rgb(0.1, 0.1, 0.1);
  const W = 595.28;
  const H = 841.89;
  const L = 28;
  const R = W - 22;
  let page = pdf.addPage([W, H]);
  let y = 48; // top-based baseline
  const t = (s: string, x: number, f = reg, size = 9, color = ink) => page.drawText(s, { x, y: H - y, size, font: f, color });
  const heading = (s: string) => {
    y += 22;
    t(s, L, reg, 11, blue);
    page.drawLine({ start: { x: L, y: H - y - 4 }, end: { x: R, y: H - y - 4 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
    y += 18;
  };
  // letter-spaced name (glyphs separated by literal spaces, as some builders emit)
  t('A L E X', L, reg, 22, blue);
  t('R I V E R A', L + reg.widthOfTextAtSize('A L E X', 22) + 14, reg, 22, blue);
  y += 14;
  t('Pune, Maharashtra, India  |  +91-9000000000  |  alex.rivera@example.com', L);
  y += 13;
  const linkText = 'https://alexrivera.dev';
  t(linkText, L);
  const linkRect = [L, H - y - 2, L + reg.widthOfTextAtSize(linkText, 9), H - y + 9];
  const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: linkRect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://alexrivera.dev') } });
  page.node.addAnnot(pdf.context.register(annot));

  heading('EDUCATION');
  const cols = [L, 300, 420, 500, R];
  const rows = [
    ['Course', 'Institute', 'Year', 'Result'],
    ['Bachelor of Technology (Computer Science)', 'IIT Bombay', '2019', '8.2 CGPA'],
    ['HSC (Science)', 'Fergusson College', '2015', '92%'],
  ];
  for (const r of rows) {
    const top = y - 11;
    r.forEach((c, i) => t(c, cols[i] + 6, i === 0 && r === rows[0] ? bold : r === rows[0] ? bold : reg));
    for (const x of cols) page.drawLine({ start: { x, y: H - top }, end: { x, y: H - top - 16 }, thickness: 0.5, color: ink });
    page.drawLine({ start: { x: L, y: H - top }, end: { x: R, y: H - top }, thickness: 0.5, color: ink });
    y += 16;
  }
  page.drawLine({ start: { x: L, y: H - (y - 11) }, end: { x: R, y: H - (y - 11) }, thickness: 0.5, color: ink });

  heading('SKILLS');
  const skillRows: [string, string[]][] = [
    ['Programming Languages', ['Go, Python, Java, TypeScript, Scala, Rust, C++, Kotlin, Ruby on Rails, JavaScript, React.js, Node.js,', 'Express.js, Flask']],
    ['Databases', ['PostgreSQL, MongoDB, Cassandra, Redis, Elasticsearch, DynamoDB']],
    ['Other', ['AWS, Docker, Kubernetes, Kafka, GraphQL, gRPC, Spark, Airflow, Jenkins, Git, Microservices, Low', 'Level Design (LLD), System Design, CI/CD']],
  ];
  for (const [label, lines] of skillRows) {
    t(label, L + 1, bold);
    lines.forEach((ln, i) => {
      t(ln, 150, reg);
      y += i < lines.length - 1 ? 11 : 13;
    });
  }

  heading('WORK EXPERIENCE');
  const job = (head: string, title: string, bullets: string[][]) => {
    t(head, L, bold);
    y += 12;
    t(title, L, reg);
    y += 14;
    for (const b of bullets) {
      page.drawCircle({ x: 50, y: H - y + 3, size: 1.6, color: ink });
      b.forEach((ln, i) => {
        t(ln, 58);
        y += i < b.length - 1 ? 12 : 14;
      });
    }
    y += 6;
  };
  job('Initech - Pune, Maharashtra (Jun 2021 - Present)', 'Senior Software Engineer', [
    ['Built Go and Kafka services that process payment events for 4M merchants with exactly-once delivery and', 'automated reconciliation.'],
    ['Led the migration of batch jobs from cron to Airflow on Kubernetes, cutting failures by 60%.'],
    ['Designed GraphQL APIs backed by PostgreSQL and Redis for the merchant dashboard.'],
  ]);
  job('Globex - Mumbai, Maharashtra (Jul 2019 - May 2021)', 'Software Engineer', [
    ['Developed REST APIs in Java and Spring Boot for order management.'],
    ['Wrote Spark jobs that aggregate clickstream data into DynamoDB for reporting.'],
  ]);
  // Fill the rest of page 1 with more roles so that inserting lines must flow onto page 2.
  for (let n = 0; n < 6; n++) {
    job(`Contract Project ${n + 1} - Remote (Jan 201${n} - Dec 201${n})`, 'Software Developer', [
      [`Implemented feature set ${n + 1} for an internal analytics tool using Python and Flask.`],
      [`Maintained CI/CD pipelines in Jenkins for project ${n + 1}.`],
    ]);
  }
  page = pdf.addPage([W, H]);
  y = 40;
  heading('PROJECTS');
  y -= 22;
  y += 10;
  t('Open-source contributor', L, bold);
  y += 14;
  page.drawCircle({ x: 50, y: H - y + 3, size: 1.6, color: ink });
  t('Contributed bug fixes to the Kafka Go client.', 58);
  return pdf.save();
}

export function buildText(md = false): string {
  const h = (t: string) => (md ? `## ${t[0]}${t.slice(1).toLowerCase()}` : t);
  const out: string[] = [];
  out.push(md ? `# ${RESUME.name}` : RESUME.name.toUpperCase());
  out.push(RESUME.contact.join(' | '));
  out.push('', h('SUMMARY'), RESUME.summary, '', h('EXPERIENCE'));
  RESUME.experience.forEach((e, i) => {
    if (i) out.push('');
    out.push(md ? `**${e.title}** | ${e.company} | ${e.location} | ${e.dates}` : `${e.title} | ${e.company} | ${e.location} | ${e.dates}`);
    for (const b of e.bullets) out.push(`${md ? '-' : '•'} ${b}`);
  });
  out.push('', h('EDUCATION'), `${RESUME.education.school} | ${RESUME.education.degree} | ${RESUME.education.dates}`);
  out.push('', h('SKILLS'));
  for (const [c, i] of RESUME.skills) out.push(`${c}: ${i}`);
  out.push('', h('PROJECTS'));
  for (const p of RESUME.projects) {
    out.push(`${p.name} | ${p.url}`);
    for (const b of p.bullets) out.push(`${md ? '-' : '•'} ${b}`);
  }
  out.push('', h('CERTIFICATIONS'), ...RESUME.certifications);
  return out.join('\n') + '\n';
}

export function buildJsonResume(): string {
  return JSON.stringify(
    {
      basics: {
        name: RESUME.name,
        label: 'Senior Software Engineer',
        email: 'jane.doe@example.com',
        phone: '(206) 555-0142',
        summary: RESUME.summary,
        location: { city: 'Seattle', region: 'WA' },
        profiles: [
          { network: 'LinkedIn', url: 'https://linkedin.com/in/janedoe' },
          { network: 'GitHub', url: 'https://github.com/janedoe' },
        ],
      },
      work: [
        { name: 'Northwind Commerce', position: 'Senior Software Engineer', startDate: '2021-03', highlights: RESUME.experience[0].bullets },
        { name: 'Contoso Health', position: 'Software Engineer', startDate: '2018-06', endDate: '2021-02', highlights: RESUME.experience[1].bullets },
      ],
      education: [{ institution: 'University of Washington', studyType: 'B.S.', area: 'Computer Science', startDate: '2014', endDate: '2018' }],
      skills: RESUME.skills.map(([name, items]) => ({ name, keywords: items.split(', ') })),
    },
    null,
    2,
  );
}

async function main() {
  fs.mkdirSync(path.join(outDir, 'resumes'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'resumes', 'jane-doe.docx'), await buildDocx());
  fs.writeFileSync(path.join(outDir, 'resumes', 'jane-doe.pdf'), await buildPdf());
  fs.writeFileSync(path.join(outDir, 'resumes', 'alex-table.pdf'), await buildTablePdf());
  fs.writeFileSync(path.join(outDir, 'resumes', 'jane-doe.txt'), buildText(false));
  fs.writeFileSync(path.join(outDir, 'resumes', 'jane-doe.md'), buildText(true));
  fs.writeFileSync(path.join(outDir, 'resumes', 'jane-doe.json'), buildJsonResume());
  fs.writeFileSync(path.join(outDir, 'resumes', 'corrupted.pdf'), Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >>\ngarbage-without-xref'));
  fs.writeFileSync(path.join(outDir, 'resumes', 'not-a-resume.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]));
  fs.writeFileSync(path.join(outDir, 'jobs', 'backend-senior.txt'), BACKEND_JD);
  fs.writeFileSync(path.join(outDir, 'jobs', 'frontend.txt'), FRONTEND_JD);
  console.log('Fixtures written to', outDir);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
