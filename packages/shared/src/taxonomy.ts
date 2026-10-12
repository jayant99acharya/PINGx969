/**
 * Skills/technology taxonomy. Used for skill extraction (job + resume), canonicalization,
 * implication ("PostgreSQL" implies "SQL") and transferability (same family).
 *
 * Entry fields:
 *  - name: canonical display name
 *  - cat: category
 *  - aliases: alternate spellings (matched case-insensitively unless `cs` is set)
 *  - implies: canonical names this skill implies the candidate also has
 *  - family: skills in the same family are "potentially transferable"
 *  - cs: case-sensitive match only (for ambiguous words like "Go", "R", "Swift")
 */
export type SkillCategory =
  | 'language'
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'database'
  | 'cloud'
  | 'devops'
  | 'data'
  | 'ml'
  | 'testing'
  | 'tool'
  | 'practice'
  | 'security'
  | 'soft';

export interface SkillEntry {
  name: string;
  cat: SkillCategory;
  aliases?: string[];
  implies?: string[];
  family?: string;
  cs?: boolean;
}

const E = (
  name: string,
  cat: SkillCategory,
  opts: Omit<SkillEntry, 'name' | 'cat'> = {},
): SkillEntry => ({ name, cat, ...opts });

export const SKILLS: SkillEntry[] = [
  // Languages
  E('Python', 'language', { aliases: ['python3', 'python 3'] }),
  E('Java', 'language', { family: 'jvm', cs: true, aliases: ['JAVA'] }),
  E('Kotlin', 'language', { family: 'jvm' }),
  E('Scala', 'language', { family: 'jvm' }),
  E('JavaScript', 'language', { aliases: ['JS', 'ES6', 'ECMAScript', 'Javascript'], cs: false }),
  E('TypeScript', 'language', { aliases: ['TS'], implies: ['JavaScript'] }),
  E('Go', 'language', { aliases: ['Golang', 'golang'], cs: true }),
  E('Rust', 'language', { cs: true }),
  E('C', 'language', { cs: true, family: 'c-family' }),
  E('C++', 'language', { aliases: ['cpp', 'C/C++'], family: 'c-family' }),
  E('C#', 'language', { aliases: ['csharp', 'C Sharp'], family: 'dotnet' }),
  E('Ruby', 'language', { cs: true }),
  E('PHP', 'language'),
  E('Swift', 'language', { cs: true, family: 'apple' }),
  E('Objective-C', 'language', { family: 'apple' }),
  E('R', 'language', { cs: true }),
  E('MATLAB', 'language', { aliases: ['Matlab'] }),
  E('Perl', 'language', { cs: true }),
  E('Elixir', 'language'),
  E('Erlang', 'language'),
  E('Haskell', 'language'),
  E('Clojure', 'language', { family: 'jvm' }),
  E('Dart', 'language', { cs: true }),
  E('Lua', 'language', { cs: true }),
  E('Bash', 'language', { aliases: ['shell scripting', 'Shell', 'sh', 'zsh'], cs: false }),
  E('PowerShell', 'language'),
  E('SQL', 'database', { cs: true, aliases: ['T-SQL', 'PL/SQL'] }),
  E('HTML', 'frontend', { aliases: ['HTML5'] }),
  E('CSS', 'frontend', { aliases: ['CSS3'] }),
  E('Solidity', 'language'),

  // Frontend
  E('React', 'frontend', { aliases: ['React.js', 'ReactJS', 'React JS'], implies: ['JavaScript'], family: 'spa' }),
  E('Angular', 'frontend', { aliases: ['AngularJS', 'Angular.js'], family: 'spa', implies: ['TypeScript'] }),
  E('Vue', 'frontend', { aliases: ['Vue.js', 'VueJS', 'Vue 3'], implies: ['JavaScript'], family: 'spa' }),
  E('Svelte', 'frontend', { aliases: ['SvelteKit'], family: 'spa' }),
  E('Next.js', 'frontend', { aliases: ['NextJS', 'Next JS'], implies: ['React'] }),
  E('Nuxt', 'frontend', { aliases: ['Nuxt.js'], implies: ['Vue'] }),
  E('Redux', 'frontend', { implies: ['React'] }),
  E('jQuery', 'frontend'),
  E('Sass', 'frontend', { aliases: ['SCSS'] }),
  E('Tailwind CSS', 'frontend', { aliases: ['Tailwind', 'TailwindCSS'] }),
  E('Webpack', 'frontend', { family: 'bundler' }),
  E('Vite', 'frontend', { family: 'bundler', cs: true }),
  E('D3.js', 'frontend', { aliases: ['D3'] }),
  E('Storybook', 'frontend'),
  E('Accessibility', 'frontend', { aliases: ['a11y', 'WCAG'] }),

  // Backend
  E('Node.js', 'backend', { aliases: ['Node', 'NodeJS', 'Node JS'], implies: ['JavaScript'], cs: false }),
  E('Express', 'backend', { aliases: ['Express.js', 'ExpressJS'], implies: ['Node.js'], cs: true }),
  E('NestJS', 'backend', { aliases: ['Nest.js'], implies: ['Node.js', 'TypeScript'] }),
  E('Django', 'backend', { implies: ['Python'], family: 'python-web' }),
  E('Flask', 'backend', { implies: ['Python'], family: 'python-web' }),
  E('FastAPI', 'backend', { implies: ['Python'], family: 'python-web' }),
  E('Spring Boot', 'backend', { aliases: ['Spring', 'Spring Framework', 'SpringBoot'], implies: ['Java'], cs: true }),
  E('Ruby on Rails', 'backend', { aliases: ['Rails', 'RoR'], implies: ['Ruby'], cs: true }),
  E('Laravel', 'backend', { implies: ['PHP'] }),
  E('.NET', 'backend', { aliases: ['dotnet', 'ASP.NET', '.NET Core', 'ASP.NET Core'], family: 'dotnet' }),
  E('REST APIs', 'backend', {
    aliases: ['REST', 'RESTful', 'RESTful APIs', 'REST API', 'RESTful API', 'RESTful services', 'REST services'],
    family: 'api',
  }),
  E('GraphQL', 'backend', { family: 'api' }),
  E('gRPC', 'backend', { family: 'api', aliases: ['protobuf', 'Protocol Buffers'] }),
  E('Microservices', 'backend', { aliases: ['microservice', 'micro-services', 'microservice architecture'], family: 'architecture' }),
  E('Distributed Systems', 'backend', { aliases: ['distributed system', 'distributed computing'], family: 'architecture' }),
  E('System Design', 'backend', { aliases: ['systems design', 'software architecture', 'architecture design'] }),
  E('Event-Driven Architecture', 'backend', { aliases: ['event-driven', 'event driven', 'event sourcing'], family: 'architecture' }),
  E('Serverless', 'cloud', { aliases: ['serverless architecture'] }),
  E('WebSockets', 'backend', { aliases: ['WebSocket', 'socket.io'] }),
  E('Kafka', 'backend', { aliases: ['Apache Kafka'], family: 'messaging' }),
  E('RabbitMQ', 'backend', { family: 'messaging' }),
  E('Amazon SQS', 'cloud', { aliases: ['SQS'], family: 'messaging', implies: ['AWS'] }),
  E('Pub/Sub', 'cloud', { aliases: ['Google Pub/Sub', 'PubSub'], family: 'messaging', implies: ['GCP'] }),
  E('Celery', 'backend', { implies: ['Python'] }),
  E('Nginx', 'devops', { aliases: ['NGINX'] }),
  E('OAuth', 'security', { aliases: ['OAuth2', 'OAuth 2.0', 'OpenID Connect', 'OIDC'] }),
  E('JWT', 'security'),

  // Mobile
  E('React Native', 'mobile', { implies: ['React', 'JavaScript'], family: 'mobile-xplat' }),
  E('Flutter', 'mobile', { implies: ['Dart'], family: 'mobile-xplat' }),
  E('iOS', 'mobile', { cs: true, family: 'apple' }),
  E('Android', 'mobile', { family: 'android' }),
  E('SwiftUI', 'mobile', { implies: ['Swift', 'iOS'] }),
  E('Jetpack Compose', 'mobile', { implies: ['Kotlin', 'Android'] }),

  // Databases
  E('PostgreSQL', 'database', { aliases: ['Postgres', 'Postgre', 'psql', 'Postgres SQL'], implies: ['SQL'], family: 'rdbms' }),
  E('MySQL', 'database', { implies: ['SQL'], family: 'rdbms', aliases: ['MariaDB'] }),
  E('SQL Server', 'database', { aliases: ['MSSQL', 'MS SQL', 'Microsoft SQL Server'], implies: ['SQL'], family: 'rdbms' }),
  E('Oracle Database', 'database', { aliases: ['Oracle DB', 'Oracle'], implies: ['SQL'], family: 'rdbms', cs: true }),
  E('SQLite', 'database', { implies: ['SQL'], family: 'rdbms' }),
  E('NoSQL', 'database', { family: 'nosql' }),
  E('MongoDB', 'database', { aliases: ['Mongo'], implies: ['NoSQL'], family: 'nosql' }),
  E('DynamoDB', 'database', { aliases: ['Dynamo DB', 'Amazon DynamoDB'], implies: ['NoSQL', 'AWS'], family: 'nosql' }),
  E('Cassandra', 'database', { aliases: ['Apache Cassandra'], implies: ['NoSQL'], family: 'nosql' }),
  E('Redis', 'database', { family: 'cache' }),
  E('Memcached', 'database', { family: 'cache' }),
  E('Elasticsearch', 'database', { aliases: ['Elastic Search', 'ElasticSearch', 'OpenSearch', 'ELK'], family: 'search' }),
  E('Neo4j', 'database'),
  E('Firebase', 'database', { aliases: ['Firestore'] }),
  E('Supabase', 'database', { implies: ['PostgreSQL'] }),

  // Cloud
  E('AWS', 'cloud', { aliases: ['Amazon Web Services'], family: 'cloud', cs: true }),
  E('GCP', 'cloud', { aliases: ['Google Cloud', 'Google Cloud Platform'], family: 'cloud' }),
  E('Azure', 'cloud', { aliases: ['Microsoft Azure'], family: 'cloud' }),
  E('AWS Lambda', 'cloud', { aliases: ['Lambda'], implies: ['AWS', 'Serverless'], cs: true }),
  E('EC2', 'cloud', { implies: ['AWS'] }),
  E('S3', 'cloud', { aliases: ['Amazon S3'], implies: ['AWS'], cs: true }),
  E('ECS', 'cloud', { aliases: ['Amazon ECS', 'Fargate'], implies: ['AWS', 'Docker'], cs: true }),
  E('EKS', 'cloud', { aliases: ['Amazon EKS'], implies: ['AWS', 'Kubernetes'], cs: true }),
  E('GKE', 'cloud', { implies: ['GCP', 'Kubernetes'], cs: true }),
  E('AKS', 'cloud', { implies: ['Azure', 'Kubernetes'], cs: true }),
  E('Cloud Run', 'cloud', { implies: ['GCP'] }),
  E('Heroku', 'cloud'),
  E('Vercel', 'cloud'),
  E('Cloudflare', 'cloud'),

  // DevOps
  E('Docker', 'devops', { aliases: ['containers', 'containerization', 'Dockerfile', 'docker-compose', 'Docker Compose'], family: 'containers' }),
  E('Kubernetes', 'devops', { aliases: ['K8s', 'k8s'], family: 'containers' }),
  E('Helm', 'devops', { implies: ['Kubernetes'], cs: true }),
  E('Terraform', 'devops', { family: 'iac' }),
  E('CloudFormation', 'devops', { aliases: ['AWS CloudFormation'], family: 'iac', implies: ['AWS'] }),
  E('Pulumi', 'devops', { family: 'iac' }),
  E('Ansible', 'devops', { family: 'config-mgmt' }),
  E('Chef', 'devops', { family: 'config-mgmt', cs: true }),
  E('Puppet', 'devops', { family: 'config-mgmt', cs: true }),
  E('Infrastructure as Code', 'devops', { aliases: ['IaC', 'infrastructure-as-code'] }),
  E('CI/CD', 'devops', {
    aliases: ['CI CD', 'CICD', 'continuous integration', 'continuous delivery', 'continuous deployment', 'CI/CD pipelines'],
  }),
  E('Jenkins', 'devops', { implies: ['CI/CD'], family: 'ci' }),
  E('GitHub Actions', 'devops', { implies: ['CI/CD'], family: 'ci' }),
  E('GitLab CI', 'devops', { aliases: ['GitLab CI/CD', 'GitLab'], implies: ['CI/CD'], family: 'ci' }),
  E('CircleCI', 'devops', { implies: ['CI/CD'], family: 'ci' }),
  E('ArgoCD', 'devops', { aliases: ['Argo CD'], implies: ['Kubernetes', 'CI/CD'] }),
  E('Linux', 'devops', { aliases: ['Ubuntu', 'RHEL', 'CentOS', 'Debian'] }),
  E('Git', 'tool', { cs: true, aliases: ['GitHub', 'Bitbucket'] }),
  E('Prometheus', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('Grafana', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('Datadog', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('New Relic', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('Splunk', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('Sentry', 'devops', { implies: ['Observability'], family: 'monitoring', cs: true }),
  E('OpenTelemetry', 'devops', { implies: ['Observability'], family: 'monitoring' }),
  E('SignalFx', 'devops', { aliases: ['Splunk Observability'], implies: ['Observability'], family: 'monitoring' }),
  E('GitHub Copilot', 'tool', { aliases: ['Copilot'], family: 'ai-assist', cs: true }),
  E('Observability', 'devops', { aliases: ['monitoring and alerting', 'monitoring', 'logging and monitoring'] }),
  E('Site Reliability Engineering', 'devops', { aliases: ['SRE'] }),

  // Data
  E('Apache Spark', 'data', { aliases: ['Spark', 'PySpark'], cs: true, family: 'bigdata' }),
  E('Hadoop', 'data', { family: 'bigdata' }),
  E('Airflow', 'data', { aliases: ['Apache Airflow'], family: 'orchestration' }),
  E('dbt', 'data', { cs: true }),
  E('Snowflake', 'data', { family: 'warehouse', cs: true }),
  E('BigQuery', 'data', { family: 'warehouse', implies: ['GCP', 'SQL'] }),
  E('Redshift', 'data', { family: 'warehouse', implies: ['AWS', 'SQL'] }),
  E('Databricks', 'data', { implies: ['Apache Spark'] }),
  E('Delta Lake', 'data', { family: 'lakehouse' }),
  E('Dagster', 'data', { family: 'orchestration' }),
  E('Prefect', 'data', { family: 'orchestration', cs: true }),
  E('Data Modeling', 'data', { aliases: ['data modelling', 'schema design'] }),
  E('ETL', 'data', { aliases: ['ELT', 'data pipelines', 'data pipeline'] }),
  E('Data Engineering', 'data'),
  E('Data Analysis', 'data', { aliases: ['data analytics', 'data analysis', 'analyzing data'] }),
  E('Pandas', 'data', { implies: ['Python'] }),
  E('NumPy', 'data', { implies: ['Python'] }),
  E('Tableau', 'data', { family: 'bi' }),
  E('Power BI', 'data', { aliases: ['PowerBI'], family: 'bi' }),
  E('Looker', 'data', { family: 'bi', cs: true }),
  E('Excel', 'tool', { aliases: ['Microsoft Excel'], cs: true }),
  E('A/B Testing', 'data', { aliases: ['A/B tests', 'experimentation'] }),
  E('Statistics', 'data', { aliases: ['statistical analysis'] }),

  // ML / AI
  E('Machine Learning', 'ml', { aliases: ['ML'], cs: false }),
  E('Deep Learning', 'ml', { implies: ['Machine Learning'] }),
  E('NLP', 'ml', { aliases: ['natural language processing'], implies: ['Machine Learning'] }),
  E('Computer Vision', 'ml', { implies: ['Machine Learning'] }),
  E('LLMs', 'ml', { aliases: ['LLM', 'large language models', 'large language model', 'generative AI', 'GenAI'], implies: ['Machine Learning'] }),
  E('TensorFlow', 'ml', { implies: ['Machine Learning', 'Python'], family: 'dl-framework' }),
  E('PyTorch', 'ml', { implies: ['Machine Learning', 'Python'], family: 'dl-framework' }),
  E('Keras', 'ml', { implies: ['Machine Learning'], family: 'dl-framework' }),
  E('scikit-learn', 'ml', { aliases: ['sklearn', 'scikit learn'], implies: ['Machine Learning', 'Python'] }),
  E('MLOps', 'ml'),

  // Testing
  E('Unit Testing', 'testing', { aliases: ['unit tests', 'automated testing', 'test automation', 'automated tests'] }),
  E('TDD', 'testing', { aliases: ['test-driven development', 'test driven development'], implies: ['Unit Testing'] }),
  E('Jest', 'testing', { implies: ['Unit Testing'], family: 'test-fw', cs: true }),
  E('Vitest', 'testing', { implies: ['Unit Testing'], family: 'test-fw' }),
  E('Mocha', 'testing', { implies: ['Unit Testing'], family: 'test-fw', cs: true }),
  E('Pytest', 'testing', { aliases: ['py.test'], implies: ['Unit Testing', 'Python'], family: 'test-fw' }),
  E('JUnit', 'testing', { implies: ['Unit Testing', 'Java'], family: 'test-fw' }),
  E('Cypress', 'testing', { family: 'e2e', cs: true }),
  E('Playwright', 'testing', { family: 'e2e' }),
  E('Selenium', 'testing', { family: 'e2e' }),
  E('Integration Testing', 'testing', { aliases: ['integration tests', 'end-to-end testing', 'e2e testing'] }),

  // Security
  E('Application Security', 'security', { aliases: ['AppSec', 'secure coding', 'OWASP'] }),
  E('IAM', 'security', { aliases: ['identity and access management'], cs: true }),
  E('Encryption', 'security', { aliases: ['cryptography', 'TLS', 'SSL'] }),

  // Tools & practices
  E('Jira', 'tool'),
  E('Confluence', 'tool'),
  E('Figma', 'tool'),
  E('Postman', 'tool'),
  E('Agile', 'practice', { aliases: ['Scrum', 'Kanban', 'agile methodologies', 'agile development'] }),
  E('Code Review', 'practice', { aliases: ['code reviews', 'peer review'] }),
  E('Performance Optimization', 'practice', { aliases: ['performance tuning', 'performance engineering'] }),
  E('API Design', 'practice', { aliases: ['API development', 'designing APIs'] }),
  E('Data Structures', 'practice', { aliases: ['algorithms', 'data structures and algorithms', 'DSA'] }),
  E('Object-Oriented Programming', 'practice', { aliases: ['OOP', 'object oriented', 'object-oriented design', 'OOD'] }),
  E('Caching', 'practice', { aliases: ['cache', 'CDN'] }),
  E('Domain-Driven Design', 'practice', { aliases: ['domain driven design', 'DDD'] }),
  E('Design Patterns', 'practice', { aliases: ['design pattern', 'clean architecture', 'SOLID principles'] }),
  E('Networking', 'practice', { aliases: ['TCP/IP', 'HTTP', 'DNS'] }),
  E('Technical Writing', 'practice', { aliases: ['technical documentation'] }),

  // Soft skills
  E('Communication', 'soft', { aliases: ['written and verbal communication', 'communication skills', 'verbal communication', 'written communication'] }),
  E('Leadership', 'soft', { aliases: ['technical leadership', 'team leadership', 'led a team', 'leading teams'] }),
  E('Mentoring', 'soft', { aliases: ['mentorship', 'mentored', 'mentor', 'coaching'] }),
  E('Collaboration', 'soft', { aliases: ['cross-functional', 'cross functional', 'teamwork', 'collaborative', 'collaborated'] }),
  E('Problem Solving', 'soft', { aliases: ['problem-solving', 'analytical skills', 'troubleshooting'] }),
  E('Project Management', 'soft', { aliases: ['program management'] }),
  E('Stakeholder Management', 'soft', { aliases: ['stakeholders', 'stakeholder communication'] }),
  E('Ownership', 'soft', { aliases: ['end-to-end ownership', 'take ownership'] }),
];

export interface DomainEntry {
  name: string;
  terms: string[];
}

export const DOMAINS: DomainEntry[] = [
  { name: 'Fintech', terms: ['fintech', 'payments', 'payment', 'banking', 'financial services', 'trading', 'lending', 'credit card', 'ledger', 'fraud', 'pci', 'kyc', 'aml', 'brokerage', 'insurance', 'insurtech'] },
  { name: 'Healthcare', terms: ['healthcare', 'health care', 'clinical', 'patient', 'hipaa', 'ehr', 'emr', 'medical', 'telehealth', 'pharma', 'biotech', 'life sciences'] },
  { name: 'E-commerce', terms: ['e-commerce', 'ecommerce', 'retail', 'checkout', 'shopping cart', 'marketplace', 'storefront', 'inventory', 'order management'] },
  { name: 'AdTech / Marketing', terms: ['adtech', 'advertising', 'ad serving', 'programmatic', 'marketing automation', 'martech', 'campaigns', 'attribution'] },
  { name: 'Gaming', terms: ['gaming', 'game engine', 'unity', 'unreal', 'multiplayer', 'esports'] },
  { name: 'Security', terms: ['cybersecurity', 'security operations', 'threat detection', 'vulnerability', 'siem', 'zero trust', 'identity'] },
  { name: 'AI / ML', terms: ['machine learning', 'artificial intelligence', 'ml platform', 'model training', 'inference', 'llm', 'generative ai', 'recommendation', 'recommender'] },
  { name: 'Data & Analytics', terms: ['data platform', 'analytics', 'data warehouse', 'business intelligence', 'big data', 'data lake', 'etl', 'reporting'] },
  { name: 'SaaS / B2B', terms: ['saas', 'b2b', 'enterprise software', 'multi-tenant', 'subscription', 'crm', 'erp'] },
  { name: 'Logistics', terms: ['logistics', 'supply chain', 'shipping', 'fulfillment', 'warehouse management', 'fleet', 'delivery'] },
  { name: 'EdTech', terms: ['edtech', 'education technology', 'learning platform', 'students', 'lms', 'e-learning'] },
  { name: 'Crypto / Web3', terms: ['blockchain', 'crypto', 'cryptocurrency', 'web3', 'defi', 'smart contracts', 'ethereum'] },
  { name: 'Telecom', terms: ['telecom', 'telecommunications', '5g', 'carrier', 'voip'] },
  { name: 'Automotive / Mobility', terms: ['automotive', 'autonomous', 'vehicle', 'mobility', 'ride-sharing', 'rideshare'] },
  { name: 'Developer Tools / Infrastructure', terms: ['developer tools', 'developer experience', 'devtools', 'platform engineering', 'internal tools', 'developer productivity', 'cloud infrastructure', 'infrastructure platform'] },
  { name: 'Media / Streaming', terms: ['video streaming', 'live streaming', 'music streaming', 'streaming service', 'video platform', 'media company', 'content delivery', 'publishing'] },
  { name: 'Government / Public sector', terms: ['government', 'public sector', 'federal', 'defense', 'clearance'] },
];

// ---- matching index -------------------------------------------------------

interface CompiledAlias {
  entry: SkillEntry;
  surface: string;
  re: RegExp;
}

const CASE_SENSITIVE_ALIASES = new Set(['Node', 'Shell', 'Mongo', 'Oracle', 'Elastic Search', 'Rails', 'Spring', 'Dynamo DB', 'ELK', 'TLS', 'SSL', 'DNS', 'HTTP', 'CDN', 'SRE', 'OOP', 'OOD', 'DSA', 'RoR']);

let compiled: CompiledAlias[] | null = null;
const byName = new Map<string, SkillEntry>();
for (const e of SKILLS) byName.set(e.name.toLowerCase(), e);

function aliasRegex(alias: string, cs: boolean): RegExp {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
  // Word-ish boundaries that tolerate symbols like C++ / C# / .NET / Node.js
  return new RegExp(`(?<![A-Za-z0-9_+#])${esc}(?![A-Za-z0-9_+#]|\\.[A-Za-z])`, cs ? 'g' : 'gi');
}

function getCompiled(): CompiledAlias[] {
  if (compiled) return compiled;
  const list: CompiledAlias[] = [];
  for (const entry of SKILLS) {
    const surfaces = [entry.name, ...(entry.aliases ?? [])];
    for (const s of surfaces) {
      // Short aliases (<=2 chars) and aliases that are also common English words are case sensitive.
      const cs = !!entry.cs || s.length <= 2 || CASE_SENSITIVE_ALIASES.has(s);
      list.push({ entry, surface: s, re: aliasRegex(s, cs) });
    }
  }
  // Longest surfaces first so "React Native" wins over "React".
  list.sort((a, b) => b.surface.length - a.surface.length);
  compiled = list;
  return list;
}

export interface SkillMention {
  name: string;
  surface: string;
  index: number;
  category: SkillCategory;
}

/** Find all taxonomy skills mentioned in text. Overlapping shorter matches are suppressed. */
export function findSkills(text: string): SkillMention[] {
  const taken: [number, number][] = [];
  const out: SkillMention[] = [];
  for (const c of getCompiled()) {
    c.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(text))) {
      const s = m.index;
      const e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      // Guard ambiguous single-letter languages: "C" / "R" only in list-like contexts.
      if (c.entry.name === 'C' || c.entry.name === 'R') {
        const before = text.slice(Math.max(0, s - 2), s);
        const after = text.slice(e, e + 2);
        const listy = /[,:/(|•]\s?$|^\s?$/.test(before) && /^\s?[,/)|;]|^$|^\s*$/.test(after);
        if (!listy) continue;
      }
      if (c.entry.name === 'Go') {
        const ctx = text.slice(Math.max(0, s - 12), e + 12);
        if (/\b(to|will|let's|ready to|on the) Go\b|Go (to|live|ahead|beyond|forward)\b/.test(ctx)) continue;
      }
      taken.push([s, e]);
      out.push({ name: c.entry.name, surface: m[0], index: s, category: c.entry.cat });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function uniqueSkillNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of findSkills(text)) {
    if (!seen.has(m.name)) {
      seen.add(m.name);
      out.push(m.name);
    }
  }
  return out;
}

export function getSkill(name: string): SkillEntry | undefined {
  return byName.get(name.toLowerCase());
}

/** Map a free-text skill (e.g. "postgres") to its canonical taxonomy name, else return trimmed input. */
export function canonicalSkill(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const direct = byName.get(t.toLowerCase());
  if (direct) return direct.name;
  const found = findSkills(t);
  if (found.length === 1 && found[0].surface.length >= t.replace(/\s+/g, ' ').length - 2) return found[0].name;
  return t;
}

/** Transitive closure of implications for a set of canonical skills. */
export function expandImplied(skills: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>(); // implied skill -> via
  const stack: [string, string][] = [];
  for (const s of skills) stack.push([s, s]);
  const have = new Set<string>(Array.from(skills, (s) => s.toLowerCase()));
  while (stack.length) {
    const [s, via] = stack.pop()!;
    const e = getSkill(s);
    for (const imp of e?.implies ?? []) {
      const k = imp.toLowerCase();
      if (have.has(k) || out.has(imp)) continue;
      out.set(imp, via);
      stack.push([imp, via]);
    }
  }
  return out;
}

/** Skills in the same family as `skill` (excluding itself). */
export function familyMembers(skill: string): string[] {
  const e = getSkill(skill);
  if (!e?.family) return [];
  return SKILLS.filter((x) => x.family === e.family && x.name !== e.name).map((x) => x.name);
}

export function findDomains(text: string): { name: string; terms: string[] }[] {
  const lower = ` ${text.toLowerCase()} `;
  const out: { name: string; terms: string[] }[] = [];
  for (const d of DOMAINS) {
    const hits = d.terms.filter((t) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(lower));
    if (hits.length) out.push({ name: d.name, terms: hits });
  }
  return out;
}

export const TECH_CATEGORIES: SkillCategory[] = ['language', 'frontend', 'backend', 'mobile', 'database', 'cloud', 'devops', 'data', 'ml', 'testing', 'tool', 'security'];

export function isTechnology(name: string): boolean {
  const e = getSkill(name);
  return !!e && TECH_CATEGORIES.includes(e.cat);
}
