import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { A8_SYSTEM } from "../jobs/a8FunderReplyParsing";
import { FunderReplyIntentSchema, FunderReplySchema, OfferOptionSchema } from "./funderReply";

const here = dirname(fileURLToPath(import.meta.url));

describe("FunderReplySchema", () => {
  it("accepts a fully populated approval and rejects unknown intents", () => {
    const sample = {
      intent: "APPROVED",
      isAutomated: true,
      merchantName: "Balam Group LLC",
      funderName: "Funder A",
      declineReasons: [],
      declineCategory: null,
      offers: [
        {
          advanceAmount: 10000,
          factorRate: 1.38,
          paybackAmount: 13800,
          paymentAmount: 345,
          paymentFrequency: "DAILY",
          numberOfPayments: 40,
          termDays: null,
          commissionPoints: 0,
          commissionAmount: 0,
          originationFeePct: null,
          originationFeeAmount: null,
          otherFees: [],
          netFundingAmount: null,
        },
      ],
      offerBaseline: {
        approvalAmount: 10000,
        numberOfPayments: 40,
        paymentFrequency: "DAILY",
        buyRate: 1.38,
      },
      stips: [],
      questionsForBroker: [],
      links: [],
      funded: {
        amount: null,
        commissionAmount: null,
        clawbackDays: null,
        requiresConfirmationReply: false,
      },
      forwardedToAlternateFunder: null,
      summary: "Approved $10,000 over 40 daily payments, buy rate 1.38.",
      confidence: 0.95,
    };
    expect(FunderReplySchema.parse(sample).offers).toHaveLength(1);
    expect(() => FunderReplySchema.parse({ ...sample, intent: "MAYBE" })).toThrow();
    expect(() => OfferOptionSchema.parse({ advanceAmount: -1 })).toThrow();
  });

  it("emits a strict JSON schema for structured outputs", () => {
    const js = z.toJSONSchema(FunderReplySchema, { target: "draft-2020-12" }) as {
      additionalProperties?: boolean;
      properties: Record<string, unknown>;
    };
    expect(js.additionalProperties).toBe(false);
    expect(Object.keys(js.properties)).toContain("offers");
  });

  it("documents every intent in the system prompt", () => {
    for (const intent of FunderReplyIntentSchema.options) {
      if (intent === "OTHER") continue;
      expect(A8_SYSTEM).toContain(intent);
    }
  });
});

describe("a8 eval cases", () => {
  const cases = JSON.parse(
    readFileSync(join(here, "../../evals/data/a8-reply-parsing/cases.json"), "utf8"),
  ) as Array<{
    id: string;
    input: { from: string; subject: string; body: string };
    expected: { intent: string };
  }>;

  it("are well formed and use only known intents", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    const ids = new Set<string>();
    for (const c of cases) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.input.body.length).toBeGreaterThan(5);
      expect(FunderReplyIntentSchema.options).toContain(c.expected.intent);
    }
  });

  it("cover every observed reply type", () => {
    const intents = new Set(cases.map((c) => c.expected.intent));
    for (const must of [
      "ACKNOWLEDGED",
      "DECLINED",
      "APPROVED",
      "OFFER_REVISED",
      "STIP_REQUEST",
      "CONTRACT_SENT",
      "CONTRACT_SIGNED",
      "FUNDING_CALL",
      "FUNDED",
      "FOLLOW_UP",
      "MARKETING",
    ]) {
      expect(intents.has(must)).toBe(true);
    }
  });

  it("contain no real merchant names from the mailbox", () => {
    const text = JSON.stringify(cases).toLowerCase();
    for (const real of [
      "realdripnyc",
      "sendzischew",
      "en caliente",
      "allspice",
      "mystic cosmetic",
    ]) {
      expect(text.includes(real)).toBe(false);
    }
  });
});
