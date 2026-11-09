/**
 * Patient records must stay in India.
 *
 * The DPDP Act 2023 treats a patient's health records as sensitive
 * personal data, and the brief states data residency as a constraint
 * rather than a preference. Until now the only thing enforcing it was a
 * comment in `.env.example` saying to use Mumbai — so a deploy that
 * fat-fingered `AWS_REGION` would put every scan in Ohio and nothing
 * anywhere would say a word.
 *
 * A comment is documentation. This is the constraint.
 */

/** AWS regions inside India. Hyderabad opened in 2022; both are in-country. */
const INDIAN_REGIONS = new Set(["ap-south-1", "ap-south-2"]);

export interface ResidencyFinding {
  /** The setting at fault, named so the fix is obvious. */
  setting: string;
  value: string;
}

/**
 * Every configured region that isn't in India.
 *
 * Unset is not a finding: the S3 client already refuses to start
 * without a region, and reporting "undefined is not in India" on top of
 * that buries the real error under a second one.
 */
export function residencyFindings(
  env: NodeJS.ProcessEnv = process.env,
): ResidencyFinding[] {
  const findings: ResidencyFinding[] = [];

  for (const setting of ["AWS_REGION", "AWS_TEXTRACT_REGION"]) {
    const value = env[setting];
    if (value && !INDIAN_REGIONS.has(value)) findings.push({ setting, value });
  }

  // Supabase puts the region in the pooler hostname
  // (aws-0-ap-south-1.pooler.supabase.com). Only checked when it's
  // actually there — a direct db.<ref>.supabase.co URL carries no
  // region, and guessing from a project ref would be inventing a fact.
  const dbUrl = env.DATABASE_URL ?? "";
  const hinted = /aws-\d+-([a-z]+-[a-z]+-\d+)\./.exec(dbUrl);
  if (hinted?.[1] && !INDIAN_REGIONS.has(hinted[1])) {
    findings.push({ setting: "DATABASE_URL", value: hinted[1] });
  }

  return findings;
}

/**
 * Refuses to boot a production server outside India.
 *
 * Loud but non-fatal elsewhere, because local development legitimately
 * runs against LocalStack, MinIO or a throwaway bucket, and a hard stop
 * there would only teach people to delete the check.
 *
 * `DATA_RESIDENCY_ACK` is the one way past it in production, and it
 * costs something to use: the value has to be a sentence saying why,
 * and that sentence is logged at error level on every single boot
 * alongside the finding it is excusing. There is deliberately no flag
 * that just says `true` — an acknowledgement nobody had to write is an
 * acknowledgement nobody read.
 *
 * It exists for the case this was built for: a demo on synthetic
 * records, where the database is somewhere a real deployment could not
 * put it. It is not a configuration option. A server holding real
 * patient data outside India is unlawful under the DPDP Act 2023
 * whatever this variable says, and the log line is the evidence that
 * someone chose it.
 */
export function assertDataResidency(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.error,
): void {
  const findings = residencyFindings(env);
  if (findings.length === 0) return;

  const detail = findings.map((f) => `${f.setting}=${f.value}`).join(", ");
  const message =
    `Data residency: ${detail} is outside India. Patient records are ` +
    `sensitive personal data under the DPDP Act 2023 — use ap-south-1 ` +
    `(Mumbai) or ap-south-2 (Hyderabad).`;

  const ack = env.DATA_RESIDENCY_ACK?.trim();
  if (env.NODE_ENV === "production" && !ack) throw new Error(message);

  if (ack) {
    log(
      `DATA RESIDENCY OVERRIDDEN — ${message} Acknowledged: "${ack}". ` +
        `This server must not hold real patient data.`,
    );
    return;
  }
  log(`WARNING — ${message}`);
}
