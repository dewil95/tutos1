import { AiQuotaError, AiUnavailableError } from "@mca/ai";
import { GoogleApiError } from "@mca/connectors";

/** Thrown for errors a retry cannot fix (bad data, missing config); the job fails at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

const NY = "America/New_York";

/** The Google error JSON ("{"error":{"code":429,"message":...}}") reduced to its message. */
function providerMessage(message: string): string {
  const i = message.indexOf("{");
  if (i >= 0) {
    try {
      const parsed = JSON.parse(message.slice(i)) as { error?: { message?: string } };
      if (parsed.error?.message) return parsed.error.message.split("\n")[0]!.trim();
    } catch {
      // not JSON: fall through
    }
  }
  return message;
}

/**
 * What the team sees on the deal page and in Settings when a job fails: plain words first,
 * the provider's own message after, never a wall of JSON.
 */
/** Google refused the mailbox's refresh token: only reconnecting in Settings fixes it. */
export function isGoogleAccessRevoked(err: unknown): boolean {
  return (
    err instanceof GoogleApiError &&
    (err.status === 401 || /invalid_grant|invalid_token|unauthorized_client/i.test(err.message))
  );
}

export function humanizeJobError(err: unknown, retryAt?: Date): string {
  if (isGoogleAccessRevoked(err))
    return `Google access for the team mailbox expired or was revoked: Settings → Reconnect the team mailbox. Google: ${(err as Error).message.slice(0, 160)}`;
  if (err instanceof AiQuotaError) {
    const when = retryAt
      ? ` It tries again by itself at ${retryAt.toLocaleTimeString("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit" })} (New York).`
      : "";
    return `AI quota used up (Google 429).${when} Google: ${providerMessage(err.message).slice(0, 200)}`;
  }
  if (err instanceof AiUnavailableError)
    return `AI key rejected by Google: check GEMINI_API_KEY in the server settings. Google: ${providerMessage(err.message).slice(0, 200)}`;
  if (err instanceof Error) return `${err.name}: ${providerMessage(err.message)}`.slice(0, 500);
  return String(err).slice(0, 500);
}

/** The quota wait, kept between 5 minutes and 6 hours whatever Google says. */
export function quotaRetryAt(err: AiQuotaError, now: Date = new Date()): Date {
  const ms = Math.min(6 * 3_600_000, Math.max(5 * 60_000, err.retryAfterMs));
  return new Date(now.getTime() + ms);
}
