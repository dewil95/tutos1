import type { DealStage, SubmissionStatus } from "@mca/db";

/** What the deal page knows that decides the one thing to do next. */
export interface NextStepInput {
  stage: DealStage;
  reading: "reading" | "failed" | "done" | "not_application" | null;
  /** Required application fields still empty (labels). */
  missing: string[];
  /** A really signed Ascend application is on the deal. */
  signed: boolean;
  /** The merchant signed at upload and that signature is not applied yet. */
  signatureFromUploadPending: boolean;
  statements: number;
  /** Statements still being read. */
  pendingStatements: number;
  scrubbed: boolean;
  /** Contracts were requested from a lender (the deal has a sold amount). */
  contractsRequested: boolean;
  submissions: {
    funder: string;
    status: SubmissionStatus;
    /** The newest reply, in one line. */
    latest: string | null;
    offer: { amount: number | null; factor: number | null } | null;
  }[];
}

export interface NextStep {
  tone: "info" | "ok" | "warn" | "bad";
  title: string;
  detail?: string;
  action?: { label: string; href: string };
}

const CLOSED: DealStage[] = ["DEAD", "DECLINED"];
const OUT: SubmissionStatus[] = ["DECLINED", "WITHDRAWN", "EXPIRED"];
const n = (v: number | null) => (v === null ? "" : `$${Math.round(v).toLocaleString("en-US")}`);
const names = (xs: string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;

/**
 * The one line at the top of a deal: what is going on and the single thing to do about it.
 * Null when the deal is closed (the header says so) or funded.
 */
export function nextStep(d: NextStepInput): NextStep | null {
  if (CLOSED.includes(d.stage)) return null;
  if (d.stage === "FUNDED") return { tone: "ok", title: "Funded." };

  const to = (label: string, href: string) => ({ label, href });
  if (d.reading === "reading")
    return {
      tone: "info",
      title: "Reading the merchant's application…",
      detail: "Usually under a minute; this page refreshes by itself.",
    };
  if (d.reading === "failed")
    return {
      tone: "warn",
      title: "The application could not be read.",
      detail: "Read it again, or type the details.",
      action: to("Open the application", "#ascend-application"),
    };
  if (d.reading === "not_application")
    return {
      tone: "warn",
      title: "The uploaded file does not look like an application.",
      detail: "Upload the right file, or type the details.",
      action: to("Open the application", "#ascend-application"),
    };
  if (d.missing.length)
    return {
      tone: "warn",
      title: `${d.missing.length} detail${d.missing.length === 1 ? "" : "s"} missing before the merchant can sign:`,
      detail: d.missing.join(", ") + ".",
      action: to("Fill them in", "#ascend-application"),
    };
  if (!d.signed && d.signatureFromUploadPending)
    return {
      tone: "ok",
      title: "The merchant signed at upload.",
      detail: "Apply that signature to Ascend's application.",
      action: to("Apply the signature", "#ascend-application"),
    };
  if (!d.signed)
    return {
      tone: "warn",
      title: "Not signed yet.",
      detail: "Sign right here with the merchant, send a signing link, or upload the signed copy.",
      action: to("Sign", "#ascend-application"),
    };

  if (d.submissions.length === 0) {
    if (d.statements === 0)
      return {
        tone: "warn",
        title: "No bank statements yet.",
        detail: "Add the last 3–4 months, or have the merchant email them to the funding inbox.",
        action: to("Add files", "#files"),
      };
    if (d.pendingStatements > 0)
      return {
        tone: "info",
        title: `Scrubbing ${d.pendingStatements} statement${d.pendingStatements === 1 ? "" : "s"}…`,
        detail: "You can already pick the lenders; the scrub lands in a minute.",
        action: to("Pick lenders and send", "#ship"),
      };
    return {
      tone: "ok",
      title: `Ready to shop: signed${d.scrubbed ? " and scrubbed" : ""}.`,
      detail: "Tick the recommended lenders and send; one email per lender.",
      action: to("Pick lenders and send", "#ship"),
    };
  }

  const approved = d.submissions.filter((s) => s.status === "APPROVED");
  if (approved.length && !d.contractsRequested) {
    const best = approved.find((s) => s.offer?.amount) ?? approved[0]!;
    const offer = best.offer;
    return {
      tone: "ok",
      title: `Offer from ${names(approved.map((s) => s.funder))}.`,
      detail: offer?.amount
        ? `${n(offer.amount)}${offer.factor ? ` at ${offer.factor}` : ""}. Request contracts when the merchant accepts.`
        : "Open the reply for the terms; request contracts when the merchant accepts.",
      action: to("Request contracts", "#lenders"),
    };
  }
  const stips = d.submissions.filter((s) => s.status === "STIPS_REQUESTED");
  if (stips.length)
    return {
      tone: "warn",
      title: `${names(stips.map((s) => s.funder))} asked for stips.`,
      detail: stips[0]!.latest ?? undefined,
      action: to("See what they need", "#lenders"),
    };
  if (d.contractsRequested)
    return {
      tone: "info",
      title: "Contracts requested.",
      detail: "Waiting on the lender's contracts and the merchant's signature.",
      action: to("Lender status", "#lenders"),
    };
  const live = d.submissions.filter((s) => !OUT.includes(s.status));
  if (live.length === 0)
    return {
      tone: "bad",
      title: `All ${d.submissions.length} lender${d.submissions.length === 1 ? "" : "s"} declined.`,
      detail: "Send the file to more lenders, or close the deal.",
      action: to("Send to more lenders", "#ship"),
    };
  const replied = live.filter((s) => s.status !== "SENT" && s.status !== "DRAFT");
  const newest = live.find((s) => s.latest)?.latest;
  return {
    tone: "info",
    title: `Sent to ${live.length} lender${live.length === 1 ? "" : "s"} · ${replied.length} replied · waiting on ${live.length - replied.length}.`,
    detail: newest ?? undefined,
    action: to("Send to more lenders", "#ship"),
  };
}
