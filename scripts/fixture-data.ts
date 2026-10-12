/** Content for the realistic test resume and job descriptions used by tests, seed and E2E. */

export const RESUME = {
  name: 'Jane Doe',
  contact: ['Seattle, WA', 'jane.doe@example.com', '(206) 555-0142', 'linkedin.com/in/janedoe', 'github.com/janedoe'],
  summary:
    'Software engineer with 8 years of experience building web applications and backend services. Enjoys working across the stack and mentoring teammates.',
  experience: [
    {
      title: 'Senior Software Engineer',
      company: 'Northwind Commerce',
      location: 'Seattle, WA',
      dates: 'Mar 2021 – Present',
      bullets: [
        'Built backend services for internal applications.',
        'Designed REST APIs in Python and Flask serving 2M requests per day.',
        'Migrated legacy batch jobs to AWS Lambda and S3, cutting infrastructure cost by 30%.',
        'Worked on containerizing services with Docker and setting up CI/CD with GitHub Actions for 12 services across three product teams.',
        'Mentored 3 junior engineers through code reviews and pairing.',
      ],
    },
    {
      title: 'Software Engineer',
      company: 'Contoso Health',
      location: 'Portland, OR',
      dates: 'Jun 2018 – Feb 2021',
      bullets: [
        'Developed patient scheduling features using React and Node.js.',
        'Responsible for maintaining Postgres database schemas and writing SQL reports.',
        'Improved page load time by 40% by optimizing queries and adding Redis caching.',
        'Collaborated with product managers and designers in an Agile team.',
      ],
    },
  ],
  education: { school: 'University of Washington', degree: 'B.S., Computer Science', dates: '2014 – 2018' },
  skills: [
    ['Languages', 'Python, JavaScript, TypeScript, SQL'],
    ['Frameworks', 'React, Node.js, Flask'],
    ['Cloud & Tools', 'AWS, Docker, Git, GitHub Actions, Redis, PostgreSQL'],
  ] as [string, string][],
  projects: [
    {
      name: 'OpenMetrics Dashboard',
      url: 'github.com/janedoe/openmetrics',
      bullets: ['Built a real-time metrics dashboard with TypeScript and WebSockets used by 200+ developers.'],
    },
  ],
  certifications: ['AWS Certified Developer – Associate | Amazon Web Services | 2022'],
};

export const BACKEND_JD = `Senior Backend Engineer
Globex Payments — Seattle, WA (Hybrid)

About the role
Globex Payments is building the next generation of payment infrastructure for online merchants. We're looking for a Senior Backend Engineer to join our Platform team and help us scale our payments platform.

Responsibilities
- Design, build, and operate scalable backend services and REST APIs in Python
- Own services end-to-end on AWS, from design through deployment and monitoring
- Improve the reliability and performance of payment processing systems
- Build CI/CD pipelines and automate infrastructure with Terraform
- Deploy and operate containerized workloads on Kubernetes
- Mentor engineers and lead code reviews
- Collaborate with product managers and cross-functional partners to define requirements

Requirements
- 5+ years of professional software engineering experience
- Strong proficiency in Python
- Experience with AWS (Lambda, S3, EC2) and Docker
- Experience with Kubernetes and Terraform
- Solid understanding of SQL and relational databases such as PostgreSQL
- Bachelor's degree in Computer Science or a related field, or equivalent practical experience

Nice to have
- Experience with Kafka or other event streaming platforms
- Familiarity with Go
- Background in fintech or payments
- Experience with observability tools like Datadog or Prometheus

Compensation: $160,000 – $190,000 per year. This is a full-time position.
`;

export const FRONTEND_JD = `Frontend Engineer (React)
Initech — Remote (US)

We are hiring a Frontend Engineer to build delightful user experiences for our analytics SaaS product.

What you'll do:
• Build responsive, accessible UI components with React and TypeScript
• Collaborate with designers to translate Figma mockups into production code
• Improve web performance and Core Web Vitals
• Write unit tests with Jest and end-to-end tests with Cypress

What we're looking for:
• 3+ years of experience building web applications with React
• Strong JavaScript and TypeScript skills, plus HTML and CSS
• Experience with GraphQL is a plus
• Excellent written and verbal communication skills
`;
