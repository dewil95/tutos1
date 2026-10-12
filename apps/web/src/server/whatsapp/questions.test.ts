import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  FIELDS,
  fieldByKey,
  fieldStatesFromReading,
  maskPhone,
  nameMatches,
  parseAddress,
  parseDate,
  parseMoney,
  readingToDraft,
  validSsn,
} from "./questions";

const f = (key: string) => fieldByKey(key)!;

describe("answer parsers", () => {
  it("reads money the way merchants type it", () => {
    expect(parseMoney("$25,000")).toBe(25000);
    expect(parseMoney("25k")).toBe(25000);
    expect(parseMoney("1.2M")).toBe(1200000);
    expect(parseMoney("40 mil")).toBe(40000);
    expect(parseMoney("about 25k")).toBeNull();
    expect(parseMoney("0")).toBeNull();
  });

  it("reads dates in English and Spanish", () => {
    expect(parseDate("March 2019")).toBe("2019-03-01");
    expect(parseDate("marzo de 2019")).toBe("2019-03-01");
    expect(parseDate("03/2019")).toBe("2019-03-01");
    expect(parseDate("04/15/2020")).toBe("2020-04-15");
    expect(parseDate("2018")).toBe("2018-01-01");
    expect(parseDate("02/30/2020")).toBeNull();
    expect(parseDate("last year")).toBeNull();
  });

  it("reads a one-line US address", () => {
    expect(parseAddress("12 Main St, Miami, FL 33101")).toEqual({
      line1: "12 Main St",
      city: "Miami",
      state: "FL",
      postalCode: "33101",
    });
    expect(parseAddress("12 Main St Apt 4, New York NY 10001")).toMatchObject({ state: "NY" });
    expect(parseAddress("12 Main St, Miami, ZZ 33101")).toBeNull();
    expect(parseAddress("Miami")).toBeNull();
  });

  it("validates each field and keeps the format lenders expect", () => {
    expect(f("business.ein").parse("123456789")).toEqual({ ok: true, value: "12-3456789" });
    expect(f("business.ein").parse("12-34")).toEqual({ ok: false });
    expect(f("business.entityType").parse("3")).toEqual({ ok: true, value: "S_CORP" });
    expect(f("business.entityType").parse("llc")).toEqual({ ok: true, value: "LLC" });
    expect(f("business.email").parse(" Owner@Bistro.test ")).toEqual({
      ok: true,
      value: "owner@bistro.test",
    });
    expect(f("business.phone").parse("same")).toEqual({ ok: true, value: "__whatsapp__" });
    expect(f("business.phone").parse("305 555 0123")).toEqual({
      ok: true,
      value: "(305) 555-0123",
    });
    expect(f("owners.0.ownershipPct").parse("51%")).toEqual({ ok: true, value: 51 });
    expect(f("owners.0.ownershipPct").parse("150")).toEqual({ ok: false });
    expect(f("owners.0.name").parse("José Muñoz")).toEqual({ ok: true, value: "José Muñoz" });
    expect(f("owners.0.name").parse("Jose")).toEqual({ ok: false });
    expect(f("request.existingAdvances").parse("ninguno")).toEqual({ ok: true, value: [] });
    expect(f("owners.0.creditScore").parse("650")).toEqual({ ok: true, value: 650 });
    expect(f("business.startDate").parse("2999")).toEqual({ ok: false });
  });

  it("every field has both languages and a unique key", () => {
    expect(new Set(FIELDS.map((x) => x.key)).size).toBe(FIELDS.length);
    for (const x of FIELDS) {
      expect(x.ask.en && x.ask.es && x.label.en && x.label.es).toBeTruthy();
    }
  });
});

describe("signature name", () => {
  const owner = { firstName: "José", lastName: "Muñoz Rivera" };
  it("matches without accents or case, and needs first and full last name", () => {
    expect(nameMatches("jose munoz rivera", owner)).toBe(true);
    expect(nameMatches("José A. Muñoz Rivera", owner)).toBe(true);
    expect(nameMatches("Jose Munoz", owner)).toBe(false);
    expect(nameMatches("Pat Example", owner)).toBe(false);
    expect(nameMatches("Jose", { firstName: "Jose" })).toBe(false);
  });
});

describe("from the other company's application", () => {
  const reading = {
    isApplication: true,
    business: {
      legalName: "Sample Bistro LLC",
      dba: null,
      entityType: "LLC" as const,
      ein: "12 3456789",
      startDate: "2021-04-01",
      industry: "Restaurant",
      naics: null,
      phone: null,
      email: null,
      website: null,
      addressLine1: "1 Main St",
      city: "Miami",
      state: "fl",
      postalCode: "33101",
    },
    request: {
      requestedAmount: null,
      useOfFunds: null,
      statedMonthlyRevenue: 60000,
      existingAdvances: [],
    },
    owners: [
      {
        firstName: "Pat",
        lastName: "Example",
        ownershipPct: 100,
        ssn: "123456789",
        dob: "1980-02-03",
        email: null,
        phone: null,
        addressLine1: "9 Oak Ave",
        city: "Miami",
        state: "FL",
        postalCode: "33102",
        creditScoreStated: null,
      },
    ],
    signed: true,
    signatureDate: "2026-09-30",
    lowConfidenceFields: ["business.industry"],
    confidence: 0.9,
  };

  it("keeps SSN/DOB apart and normalises the rest", () => {
    const { draft, pii } = readingToDraft(reading);
    expect(pii).toEqual([{ ssn: "123-45-6789", dob: "1980-02-03" }]);
    expect(JSON.stringify(draft)).not.toMatch(/123-?45|1980-02-03/);
    expect(draft.business).toMatchObject({ ein: "12-3456789", address: { state: "FL" } });
    expect(draft.owners[0]).toMatchObject({ firstName: "Pat", lastName: "Example" });
  });

  it("asks only what is missing, confirms what was unsure", () => {
    const { draft } = readingToDraft(reading);
    const s = fieldStatesFromReading(draft, reading.lowConfidenceFields);
    expect(s["business.email"]).toBe("ask");
    expect(s["request.amount"]).toBe("ask");
    expect(s["business.industry"]).toBe("confirm");
    expect(s["request.existingAdvances"]).toBe("confirm"); // blank list: none, or left empty?
    expect(s["business.legalName"]).toBe("ok");
    expect(s["business.dba"]).toBe("ok"); // optional: not asked
    expect(
      Object.values(fieldStatesFromReading(emptyDraft(), [])).filter((v) => v === "ask"),
    ).toHaveLength(FIELDS.filter((x) => x.required).length);
  });

  it("rejects impossible SSNs and masks the phone", () => {
    expect(validSsn("000-12-3456")).toBeNull();
    expect(validSsn("123-45-6789")).toBe("123-45-6789");
    expect(maskPhone("13055550123")).toBe("+1 ••• ••• 0123");
  });
});
