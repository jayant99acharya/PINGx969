import type { FieldType } from "@pingx969/shared";
import type { FieldSignals } from "./classify";
import type { FormControl } from "./dom";

/**
 * Site adapters add knowledge about specific applicant-tracking systems on top of the
 * generic detector (which always runs as the fallback). Adding a site = adding an adapter.
 */
export interface JobSiteAdapter {
  name: string;
  matches(url: string, doc: Document): boolean;
  /** Field-type hint for a control based on ATS-specific identifiers. */
  hint?(
    el: FormControl,
    s: FieldSignals,
  ): { fieldType: FieldType; confidence: number } | null;
  /** The field's label when the ATS keeps it somewhere the generic label search can't see. */
  label?(el: Element): string | null;
  /** Job title / company from the page, when the ATS exposes them in known places. */
  jobInfo?(doc: Document): { title?: string; company?: string } | null;
}

const byMap = (
  map: Record<string, FieldType>,
  key: string,
  confidence = 0.96,
) => {
  const t = map[key];
  return t ? { fieldType: t, confidence } : null;
};

export const GreenhouseAdapter: JobSiteAdapter = {
  name: "greenhouse",
  matches: (url, doc) =>
    /(^|\.)greenhouse\.io/.test(hostOf(url)) ||
    !!doc.querySelector(
      '#application_form, form#application-form [id^="question_"], [name^="job_application["], meta[content*="greenhouse" i]',
    ),
  hint: (el) =>
    byMap(
      {
        first_name: "firstName",
        last_name: "lastName",
        email: "email",
        phone: "phone",
        "job_application[first_name]": "firstName",
        "job_application[last_name]": "lastName",
        "job_application[email]": "email",
        "job_application[phone]": "phone",
        "job_application[location]": "location",
        resume: "resume",
        cover_letter: "coverLetter",
      },
      el.id || el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => {
    const t = doc
      .querySelector(".app-title, h1.section-header, .job__title h1, h1")
      ?.textContent?.trim();
    const c = doc
      .querySelector(".company-name, .job__header .company")
      ?.textContent?.replace(/^\s*at\s+/i, "")
      .trim();
    const m = doc.title.match(/Job Application for (.+?) at (.+)$/i);
    return { title: m?.[1] ?? t, company: m?.[2] ?? c };
  },
};

export const LeverAdapter: JobSiteAdapter = {
  name: "lever",
  matches: (url, doc) =>
    /(^|\.)lever\.co/.test(hostOf(url)) ||
    !!doc.querySelector(
      'input[name="urls[LinkedIn]"], .application-form [name="org"], form[action*="lever"]',
    ),
  hint: (el) =>
    byMap(
      {
        name: "fullName",
        email: "email",
        phone: "phone",
        org: "currentCompany",
        location: "location",
        "urls[LinkedIn]": "linkedin",
        "urls[GitHub]": "github",
        "urls[Portfolio]": "portfolio",
        "urls[Twitter]": "twitter",
        "urls[Other]": "website",
        resume: "resume",
        comments: "coverLetterText",
      },
      el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => {
    const title = doc
      .querySelector(".posting-headline h2, .posting-header h2")
      ?.textContent?.trim();
    const m = doc.title.match(/^(.+?)\s+-\s+(.+)$/);
    return {
      title: title ?? m?.[2],
      company:
        m?.[1] ??
        doc.querySelector(".main-header-logo img")?.getAttribute("alt") ??
        undefined,
    };
  },
};

export const WorkdayAdapter: JobSiteAdapter = {
  name: "workday",
  matches: (url, doc) =>
    /myworkdayjobs\.com|workday\.com/.test(hostOf(url)) ||
    !!doc.querySelector(
      '[data-automation-id="legalNameSection_firstName"], [data-automation-id^="formField-"]',
    ),
  hint: (_el, s) =>
    byMap(
      {
        legalNameSection_firstName: "firstName",
        legalNameSection_lastName: "lastName",
        legalNameSection_middleName: "middleName",
        "legalName--firstName": "firstName",
        "legalName--lastName": "lastName",
        email: "email",
        "phone-number": "phone",
        phoneNumber: "phone",
        countryPhoneCode: "phoneCountryCode",
        addressSection_addressLine1: "address1",
        addressSection_addressLine2: "address2",
        addressSection_city: "city",
        addressSection_postalCode: "postalCode",
        addressSection_countryRegion: "state",
        addressLine1: "address1",
        city: "city",
        postalCode: "postalCode",
        countryRegion: "state",
        countryDropdown: "country",
        country: "country",
        linkedinQuestion: "linkedin",
        "file-upload-input-ref": "resume",
      },
      s.automationId.replace(/^formField-/, ""),
    ),
  jobInfo: (doc) => ({
    title: doc
      .querySelector('[data-automation-id="jobPostingHeader"]')
      ?.textContent?.trim(),
  }),
};

export const AshbyAdapter: JobSiteAdapter = {
  name: "ashby",
  matches: (url, doc) =>
    /(^|\.)ashbyhq\.com/.test(hostOf(url)) ||
    !!doc.querySelector('[name^="_systemfield_"]'),
  hint: (el) =>
    byMap(
      {
        _systemfield_name: "fullName",
        _systemfield_email: "email",
        _systemfield_phone: "phone",
        _systemfield_resume: "resume",
        _systemfield_location: "location",
        _systemfield_linkedin: "linkedin",
      },
      el.getAttribute("name") || el.id || "",
    ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+@\s+(.+)$/);
    return {
      title: m?.[1] ?? doc.querySelector("h1")?.textContent?.trim(),
      company: m?.[2],
    };
  },
};

export const BambooHrAdapter: JobSiteAdapter = {
  name: "bamboohr",
  matches: (url, doc) =>
    /(^|\.)bamboohr\.com/.test(hostOf(url)) ||
    !!doc.querySelector('[class*="fab-Form"], form[action*="bamboohr"]'),
  hint: (el) =>
    byMap(
      {
        firstName: "firstName",
        lastName: "lastName",
        email: "email",
        phone: "phone",
        streetAddress: "address1",
        city: "city",
        state: "state",
        zip: "postalCode",
        countryId: "country",
        dateAvailable: "startDate",
        desiredPay: "desiredSalary",
        websiteUrl: "website",
        linkedinUrl: "linkedin",
        resumeFileId: "resume",
        coverLetterFileId: "coverLetter",
      },
      el.getAttribute("name") || el.id || "",
    ),
  jobInfo: (doc) => ({
    title: doc
      .querySelector('.ApplicationForm__title, [class*="JobInfo"] h2, h2')
      ?.textContent?.trim(),
  }),
};

export const JobviteAdapter: JobSiteAdapter = {
  name: "jobvite",
  matches: (url, doc) =>
    /(^|\.)jobvite\.com/.test(hostOf(url)) ||
    !!doc.querySelector(
      '[id^="jv-field-"], .jv-form-field, [class*="jv-apply"]',
    ),
  jobInfo: (doc) => ({
    title: doc
      .querySelector(".jv-header, h2.jv-job-detail-name")
      ?.textContent?.trim(),
    company:
      doc.querySelector(".jv-logo img")?.getAttribute("alt") ?? undefined,
  }),
};

export const IcimsAdapter: JobSiteAdapter = {
  name: "icims",
  matches: (url, doc) =>
    /(^|\.)icims\.com/.test(hostOf(url)) ||
    !!doc.querySelector(
      '[name^="PersonProfileFields."], #icims_content_iframe',
    ),
  hint: (el) =>
    byMap(
      {
        "PersonProfileFields.FirstName": "firstName",
        "PersonProfileFields.MiddleName": "middleName",
        "PersonProfileFields.LastName": "lastName",
        "PersonProfileFields.Email": "email",
        "PersonProfileFields.PhoneNumber": "phone",
        "PersonProfileFields.AddressStreet1": "address1",
        "PersonProfileFields.AddressStreet2": "address2",
        "PersonProfileFields.AddressCity": "city",
        "PersonProfileFields.AddressState": "state",
        "PersonProfileFields.AddressZip": "postalCode",
        "PersonProfileFields.AddressCountry": "country",
        "PersonProfileFields.LinkedIn": "linkedin",
      },
      el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => ({
    title: doc
      .querySelector(".iCIMS_Header h1, h1.iCIMS_Header, .iCIMS_JobHeaderTitle")
      ?.textContent?.trim(),
    company: doc.title.includes("|")
      ? doc.title.split("|").pop()!.trim()
      : undefined,
  }),
};

export const WorkableAdapter: JobSiteAdapter = {
  name: "workable",
  matches: (url, doc) =>
    /(^|\.)workable\.com/.test(hostOf(url)) ||
    !!doc.querySelector('[data-ui="firstname"], [data-ui="application-form"]'),
  hint: (el) =>
    byMap(
      {
        firstname: "firstName",
        lastname: "lastName",
        email: "email",
        phone: "phone",
        address: "address1",
        city: "city",
        postcode: "postalCode",
        country: "country",
        resume: "resume",
        cover_letter: "coverLetter",
      },
      el.getAttribute("data-ui") || el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+-\s+(.+?)(\s+-\s+Application)?$/);
    return { title: m?.[1], company: m?.[2] };
  },
};

export const JazzHrAdapter: JobSiteAdapter = {
  name: "jazzhr",
  matches: (url, doc) =>
    /(^|\.)applytojob\.com|jazzhr\.com/.test(hostOf(url)) ||
    !!doc.querySelector('[name^="resumator-"]'),
  hint: (el) =>
    byMap(
      {
        "resumator-firstname-value": "firstName",
        "resumator-lastname-value": "lastName",
        "resumator-email-value": "email",
        "resumator-phone-value": "phone",
        "resumator-address-value": "address1",
        "resumator-city-value": "city",
        "resumator-state-value": "state",
        "resumator-postal-value": "postalCode",
        "resumator-resume-value": "resume",
        "resumator-coverletter-value": "coverLetterText",
        "resumator-linkedin-value": "linkedin",
        "resumator-website-value": "website",
        "resumator-salary-value": "desiredSalary",
        "resumator-eeo_gender-value": "gender",
        "resumator-eeo_race-value": "raceEthnicity",
        "resumator-eeo_veteran-value": "veteranStatus",
        "resumator-eeo_disability-value": "disabilityStatus",
      },
      el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+-\s+(.+?)\s+-\s+Career Page$/);
    return { title: m?.[1], company: m?.[2] };
  },
};

export const SmartRecruitersAdapter: JobSiteAdapter = {
  name: "smartrecruiters",
  matches: (url, doc) =>
    /(^|\.)smartrecruiters\.com|smartr\.me/.test(hostOf(url)) ||
    !!doc.querySelector('spl-input, oc-oneclick-form, [class*="oneclick"]'),
  hint: (el) =>
    byMap(
      {
        "first-name-input": "firstName",
        "last-name-input": "lastName",
        "email-input": "email",
        "confirm-email-input": "email",
        "linkedin-input": "linkedin",
        "website-input": "website",
        "hiring-manager-message-input": "coverLetterText",
        "location-autocomplete-search-input": "city",
      },
      el.id || el.getAttribute("data-sr-id") || "",
    ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^Easy apply - (.+?) - (.+)$/);
    return { title: m?.[1], company: m?.[2] };
  },
};

export const GoogleFormsAdapter: JobSiteAdapter = {
  name: "google-forms",
  matches: (url, doc) =>
    /docs\.google\.com$/.test(hostOf(url)) ||
    !!doc.querySelector('form[action*="formResponse"]'),
  jobInfo: (doc) => ({
    title:
      doc
        .querySelector('[role="heading"][aria-level="1"]')
        ?.textContent?.trim() || doc.title,
  }),
};

export const LinkedInAdapter: JobSiteAdapter = {
  name: "linkedin",
  matches: (url, doc) =>
    /(^|\.)linkedin\.com/.test(hostOf(url)) ||
    !!doc.querySelector(
      '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"]',
    ),
  hint: (el) => {
    const id = el.id || "";
    if (/phoneNumber-nationalNumber/.test(id))
      return { fieldType: "phone", confidence: 0.96 };
    if (/phoneNumber-country/.test(id))
      return { fieldType: "phoneCountryCode", confidence: 0.96 };
    return null;
  },
  jobInfo: (doc) => {
    const title = doc
      .querySelector(
        ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .t-24.t-bold",
      )
      ?.textContent?.trim();
    const company =
      doc
        .querySelector(
          ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name",
        )
        ?.textContent?.trim() ??
      doc
        .querySelector("#jobs-apply-header")
        ?.textContent?.replace(/^\s*apply to\s+/i, "")
        .trim();
    return { title, company };
  },
};

export const ZohoRecruitAdapter: JobSiteAdapter = {
  name: "zohorecruit",
  matches: (url, doc) =>
    /(^|\.)zohorecruit\.(com|in|eu|com\.au|jp|com\.cn)$/.test(hostOf(url)) ||
    !!doc.querySelector('[cx-prop-name^="rec-form_"], crux-text-component'),
  // Lyte/Crux components carry their caption in cx-prop-label; the visible label row can also cover a
  // neighbouring field (Salutation shares the "First Name" row), so it is not reliable.
  label: (el) => {
    const comp = el.closest("[cx-prop-label]");
    if (!comp) return null;
    if (
      comp.tagName === "CRUX-PHONE-COMPONENT" &&
      el.matches('[role="combobox"]:not(input)')
    )
      return "Phone country code";
    return comp.getAttribute("cx-prop-label");
  },
  hint: (el) =>
    // the dial-code dropdown shares the phone component (and its zcqa) with the number input
    el.matches('[role="combobox"]:not(input)') &&
    el.closest("crux-phone-component")
      ? { fieldType: "phoneCountryCode", confidence: 0.97 }
      : byMap(
          {
            manual_First_Name: "firstName",
            manual_Last_Name: "lastName",
            manual_Email: "email",
            manual_Mobile: "phone",
            manual_Phone: "phone",
            manual_Street: "address1",
            manual_City: "city",
            manual_State: "state",
            manual_Zip_Code: "postalCode",
            manual_Country: "country",
            manual_Current_Employer: "currentCompany",
            manual_Current_Job_Title: "currentTitle",
            manual_Experience_in_Years: "yearsExperience",
            manual_Expected_Salary: "desiredSalary",
          },
          el.closest("[cx-prop-zcqa]")?.getAttribute("cx-prop-zcqa") ?? "",
        ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+-\s+(.+?)(\s+in\s+.+)?$/);
    return { company: m?.[1], title: m?.[2] };
  },
};

export const OracleCloudAdapter: JobSiteAdapter = {
  name: "oraclecloud",
  matches: (url, doc) =>
    (/(^|\.)oraclecloud\.com$/.test(hostOf(url)) && /\/hcmUI\//i.test(url)) ||
    !!doc.querySelector(".apply-flow, .input-row__control"),
  hint: (el) =>
    byMap(
      {
        "primary-email": "email",
        firstName: "firstName",
        lastName: "lastName",
        middleNames: "middleName",
        knownAs: "preferredName",
      },
      el.getAttribute("name") || "",
    ),
  jobInfo: (doc) => ({
    title: doc
      .querySelector(".job-details__title, .apply-flow-header__title, h1")
      ?.textContent?.trim(),
    company: doc.title.match(/^(.+?)\s+Candidate Experience/i)?.[1],
  }),
};

export const KulaAdapter: JobSiteAdapter = {
  name: 'kula',
  matches: (url, doc) => /(^|\.)kula\.ai$/.test(hostOf(url)) || !!doc.querySelector('form[data-testid="job-form"], .job-form-kula-field'),
  hint: (el) =>
    // the phone field's flag button: "Select country. Currently India"
    el.matches('button[aria-haspopup="listbox"]') && /select country/i.test(el.getAttribute('aria-label') ?? '')
      ? { fieldType: 'phoneCountryCode', confidence: 0.97 }
      : byMap(
      {
        'info.first_name': 'firstName',
        'info.last_name': 'lastName',
        'info.email': 'email',
        'info.linkedin_url': 'linkedin',
        'info.github_url': 'github',
        'info.portfolio_url': 'portfolio',
        phone: 'phone',
        resume: 'resume',
      },
      el.getAttribute('name') || el.id || '',
    ),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)(?:\s+[–-]\s+[^|]+)?\s*\|\s*(.+?)\s+Careers$/);
    return { title: m?.[1], company: m?.[2] };
  },
};

export const KekaAdapter: JobSiteAdapter = {
  name: 'keka',
  matches: (url, doc) => /(^|\.)keka\.com$/.test(hostOf(url)) || !!doc.querySelector('[name="mobilePhone.number"], [name^="standardFields."]'),
  hint: (el) =>
    byMap(
      {
        firstName: 'firstName',
        middleName: 'middleName',
        lastName: 'lastName',
        email: 'email',
        'mobilePhone.number': 'phone',
        'mobilePhone.countryCode': 'phoneCountryCode',
        'workExperience.years': 'yearsExperience',
        'expectedSalary.amount': 'desiredSalary',
        'standardFields.availability.answer': 'noticePeriod',
        'standardFields.currentLocation.answer': 'location',
        gender: 'gender',
      },
      el.getAttribute('name') || '',
    ),
  jobInfo: (doc) => ({ title: doc.querySelector('.job-title, h1, h3.text-primary')?.textContent?.trim() || doc.title }),
};

const ogSiteName = (doc: Document) => doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || undefined;
const h1 = (doc: Document) => doc.querySelector('h1')?.textContent?.trim() || undefined;

export const TeamtailorAdapter: JobSiteAdapter = {
  name: 'teamtailor',
  matches: (url, doc) => /(^|\.)teamtailor\.com$/.test(hostOf(url)) || !!doc.querySelector('form[action*="/applications"][data-controller], meta[content*="teamtailor" i]'),
  jobInfo: (doc) => ({ title: h1(doc), company: ogSiteName(doc) }),
};

export const RipplingAdapter: JobSiteAdapter = {
  name: 'rippling',
  matches: (url, doc) => /^ats\.rippling\.com$/.test(hostOf(url)) || !!doc.querySelector('[data-testid^="customQuestions."]'),
  jobInfo: (doc) => {
    // ats.rippling.com/<company-slug>/jobs/<id>
    const slug = (doc.location?.pathname ?? '').split('/')[1] ?? '';
    const company = slug.replace(/-(inc|careers|llc|ltd)$/i, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    // the apply page is titled "Apply - <job title>"
    const title = doc.title.match(/^Apply\s*[-–|]\s*(.+)$/i)?.[1] ?? [...doc.querySelectorAll('h1, h2')].map((h) => h.textContent?.trim() ?? '').find((t) => t && !/^apply$/i.test(t));
    return { title, company: company || undefined };
  },
};

export const RecruiteeAdapter: JobSiteAdapter = {
  name: 'recruitee',
  matches: (url, doc) => /(^|\.)recruitee\.com$/.test(hostOf(url)) || !!doc.querySelector('[class*="recruitee" i], form[action*="recruitee"]'),
  jobInfo: (doc) => ({ title: h1(doc), company: ogSiteName(doc) }),
};

export const BreezyAdapter: JobSiteAdapter = {
  name: 'breezy',
  matches: (url, doc) => /(^|\.)breezy\.hr$/.test(hostOf(url)) || !!doc.querySelector('form[action*="breezy"], .breezy-portal'),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+at\s+(.+)$/);
    return { title: m?.[1] ?? h1(doc), company: m?.[2] };
  },
};

export const PersonioAdapter: JobSiteAdapter = {
  name: 'personio',
  matches: (url, doc) => /(^|\.)jobs\.personio\.(de|com)$/.test(hostOf(url)) || !!doc.querySelector('form[action*="personio"]'),
  jobInfo: (doc) => {
    const m = doc.title.match(/^(.+?)\s+\|\s+Jobs at\s+(.+)$/);
    return { title: m?.[1] ?? h1(doc), company: m?.[2] };
  },
};

export const GenericAdapter: JobSiteAdapter = {
  name: "generic",
  matches: () => true,
};

export const ADAPTERS: JobSiteAdapter[] = [
  GreenhouseAdapter,
  LeverAdapter,
  WorkdayAdapter,
  AshbyAdapter,
  BambooHrAdapter,
  JobviteAdapter,
  IcimsAdapter,
  WorkableAdapter,
  JazzHrAdapter,
  SmartRecruitersAdapter,
  GoogleFormsAdapter,
  LinkedInAdapter,
  ZohoRecruitAdapter,
  OracleCloudAdapter,
  KulaAdapter,
  KekaAdapter,
  TeamtailorAdapter,
  RipplingAdapter,
  RecruiteeAdapter,
  BreezyAdapter,
  PersonioAdapter,
];

/**
 * The ATS whose domain the page is on wins; DOM fingerprints are only a fallback (embedded
 * forms, custom career domains). Otherwise generic markers such as form#application-form
 * would let one adapter claim another ATS's pages.
 */
export function pickAdapter(url: string, doc: Document): JobSiteAdapter {
  const tryMatch = (d: Document) =>
    ADAPTERS.find((a) => {
      try {
        return a.matches(url, d);
      } catch {
        return false;
      }
    });
  return (
    tryMatch(doc.implementation.createHTMLDocument("")) ??
    tryMatch(doc) ??
    GenericAdapter
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
