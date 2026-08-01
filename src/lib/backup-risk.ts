/**
 * The backup tripwire.
 *
 * As of 2026-07-27 the production database has NO backups, the Supabase
 * project is on the Free plan, which includes none. The founder accepted that
 * knowingly while the tester count was single-digit, on the understanding that
 * it gets revisited at roughly twenty testers. See `docs/RUNBOOK.md` §2b.
 *
 * A decision like that is only safe if something notices when it expires. A
 * note in a document does not notice; it is exactly as reliable as the manual
 * `pg_dump` it was meant to replace, which is to say, it depends on a human
 * remembering, months later, while busy. So the threshold is enforced here and
 * surfaced in the admin console, where the person who can act on it is already
 * looking at the user count that triggers it.
 *
 * This module is pure so it can be tested; the admin analytics route supplies
 * the count and whether backups have since been turned on.
 */

/**
 * Users at which "no backups" stops being a reasonable trade.
 *
 * Not arbitrary, and not really about the number of rows. Below it, a loss is
 * recoverable by asking, a handful of testers will re-enter a check-in. Above
 * it, nobody re-uploads a blood panel, and a beta cohort that loses its data
 * does not come back. The cost of the loss changes character here, which is
 * why the threshold sits at the point it does rather than scaling with volume.
 */
export const BACKUP_REVIEW_THRESHOLD = 20;

export type BackupPosture = "none" | "protected";

export interface BackupRisk {
  posture: BackupPosture;
  users: number;
  threshold: number;
  /** True when there are no backups AND the tester count has passed the line. */
  overdue: boolean;
  /** True when there are no backups but the count is still under the line. */
  accepted: boolean;
  headroom: number;
}

export function assessBackupRisk(
  users: number,
  posture: BackupPosture,
): BackupRisk {
  const safeUsers = Number.isFinite(users) ? Math.max(0, Math.trunc(users)) : 0;
  const unprotected = posture !== "protected";

  return {
    posture,
    users: safeUsers,
    threshold: BACKUP_REVIEW_THRESHOLD,
    overdue: unprotected && safeUsers >= BACKUP_REVIEW_THRESHOLD,
    accepted: unprotected && safeUsers < BACKUP_REVIEW_THRESHOLD,
    headroom: Math.max(0, BACKUP_REVIEW_THRESHOLD - safeUsers),
  };
}

/**
 * Reads the deployment's declared backup posture.
 *
 * Defaults to "none", deliberately. If this variable goes missing, or a new
 * environment is stood up without it, the honest answer is that we do not know
 * of any backups, and the failure mode of wrongly warning is a moment of
 * annoyance, while the failure mode of wrongly staying quiet is losing every
 * user's health data. Only the explicit string flips it.
 *
 * Set `DB_BACKUPS=protected` in `wrangler.jsonc` once Supabase Pro (or another
 * real backup mechanism) is actually on, and confirm a restore first.
 */
export function declaredBackupPosture(value: string | undefined): BackupPosture {
  return value?.trim().toLowerCase() === "protected" ? "protected" : "none";
}
