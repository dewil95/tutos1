import { describe, expect, it, vi } from "vitest";
import { GmailProvider, parseAddressList, parseGmailMessage } from "../email/gmail";
import { DriveProvider, dealFolderPath, driveQuoted } from "../storage/drive";
import { GoogleApiError, GoogleAuth, googleConsentUrl } from "./auth";

type Handler = (
  url: string,
  init?: RequestInit,
) => { status?: number; json?: unknown; body?: string | Buffer };

function fakeFetch(handler: Handler) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    }
    const r = handler(url, init);
    const body = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? "");
    return new Response(typeof body === "string" ? body : new Uint8Array(body), {
      status: r.status ?? 200,
    });
  });
}

const cfg = { clientId: "cid", clientSecret: "secret" };

describe("GoogleAuth", () => {
  it("refreshes once and caches the access token until near expiry", async () => {
    let now = 0;
    const f = fakeFetch(() => ({ json: {} }));
    const auth = new GoogleAuth(cfg, "refresh", f, () => now);
    await auth.accessToken();
    await auth.accessToken();
    expect(f.mock.calls.filter((c) => c[0].includes("oauth2")).length).toBe(1);
    now = 3_600_000;
    await auth.accessToken();
    expect(f.mock.calls.filter((c) => c[0].includes("oauth2")).length).toBe(2);
  });

  it("raises GoogleApiError with the status on API failures", async () => {
    const auth = new GoogleAuth(
      cfg,
      "r",
      fakeFetch(() => ({ status: 403, body: "forbidden" })),
    );
    await expect(auth.json("https://gmail.googleapis.com/x")).rejects.toMatchObject({
      status: 403,
    });
    await expect(auth.json("https://gmail.googleapis.com/x")).rejects.toBeInstanceOf(
      GoogleApiError,
    );
  });

  it("builds an offline consent URL with Gmail and Drive scopes", () => {
    const url = new URL(
      googleConsentUrl(
        { ...cfg, redirectUri: "https://crm.example/cb" },
        "st",
        "funding@ascendfund.co",
      ),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("scope")).toContain("drive.file");
    expect(url.searchParams.get("login_hint")).toBe("funding@ascendfund.co");
  });
});

describe("GmailProvider", () => {
  it("sends base64url MIME with To/Cc and returns ids", async () => {
    let sent: { raw: string; threadId?: string } | undefined;
    const f = fakeFetch((url, init) => {
      expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      sent = JSON.parse(String(init!.body));
      return { json: { id: "m1", threadId: "t1" } };
    });
    const gmail = new GmailProvider(new GoogleAuth(cfg, "r", f));
    const r = await gmail.send({
      from: "funding@ascendfund.co",
      to: ["subs@zlur.com"],
      cc: ["jonas@ascendfund.co"],
      subject: "New Deal Submission - Test LLC",
      text: "Hello",
      correlationId: "s1",
    });
    expect(r).toEqual({ messageId: "m1", threadId: "t1" });
    const mime = Buffer.from(sent!.raw, "base64url").toString("utf8");
    expect(mime).toContain("To: subs@zlur.com");
    expect(mime).toContain("Cc: jonas@ascendfund.co");
    expect(sent!.threadId).toBeUndefined();
  });

  it("first sync backfills by date window and returns the profile historyId", async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith("/profile")) return { json: { historyId: "900" } };
      if (url.includes("/messages?q=")) return { json: { messages: [{ id: "a" }] } };
      if (url.includes("/messages/a?format=full"))
        return {
          json: {
            id: "a",
            threadId: "t",
            internalDate: "1790000000000",
            labelIds: ["INBOX"],
            payload: {
              headers: [
                { name: "From", value: "Alexis <subs@mazalfunders.com>" },
                { name: "To", value: "funding@ascendfund.co" },
                { name: "Subject", value: "Re: New Deal Submission - X" },
              ],
              mimeType: "multipart/mixed",
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: Buffer.from("SUBMISSION RECEIVED").toString("base64url") },
                },
                {
                  mimeType: "application/pdf",
                  filename: "contract.pdf",
                  body: { attachmentId: "att1", size: 10 },
                },
              ],
            },
          },
        };
      throw new Error(`unexpected ${url}`);
    });
    const r = await new GmailProvider(new GoogleAuth(cfg, "r", f)).sync(null);
    expect(r.nextCursor).toBe("900");
    expect(r.messages[0]).toMatchObject({
      from: "subs@mazalfunders.com",
      subject: "Re: New Deal Submission - X",
      text: "SUBMISSION RECEIVED",
      attachments: [{ fileName: "contract.pdf", attachmentId: "att1" }],
    });
  });

  it("incremental sync reads history and falls back to backfill when the cursor expired", async () => {
    const f = fakeFetch((url) => {
      if (url.includes("/history?")) return { status: 404, body: "expired" };
      if (url.endsWith("/profile")) return { json: { historyId: "1000" } };
      if (url.includes("/messages?q=")) return { json: {} };
      throw new Error(url);
    });
    const r = await new GmailProvider(new GoogleAuth(cfg, "r", f)).sync("5");
    expect(r).toEqual({ messages: [], nextCursor: "1000" });
  });

  it("parses HTML-only bodies and address lists", () => {
    const m = parseGmailMessage({
      id: "x",
      threadId: "t",
      payload: {
        mimeType: "text/html",
        headers: [
          {
            name: "Cc",
            value: '"Diaz, Bella" <Isabel@instagreencapital.com>, jonas@ascendfund.co',
          },
        ],
        body: { data: Buffer.from("<p>Funding $15,000<br>Rate 1.50</p>").toString("base64url") },
      },
    });
    expect(m.text).toBe("Funding $15,000\nRate 1.50");
    expect(m.cc).toEqual(["isabel@instagreencapital.com", "jonas@ascendfund.co"]);
    expect(parseAddressList(null)).toEqual([]);
  });
});

describe("DriveProvider", () => {
  it("creates only missing folders along the deal path", async () => {
    const created: string[] = [];
    const f = fakeFetch((url, init) => {
      if (url.includes("/files?q=")) {
        const q = decodeURIComponent(url.split("q=")[1]!.split("&")[0]!);
        return {
          json: {
            files: q.includes("'Ascend CRM'") ? [{ id: "root-crm", name: "Ascend CRM" }] : [],
          },
        };
      }
      if (init?.method === "POST") {
        const name = JSON.parse(String(init.body)).name as string;
        created.push(name);
        return { json: { id: `id-${created.length}` } };
      }
      throw new Error(url);
    });
    const drive = new DriveProvider(new GoogleAuth(cfg, "r", f));
    const id = await drive.ensureFolderPath(dealFolderPath("Luxury Nails / Spa", "cmdeal123456"));
    expect(created).toEqual(["Deals", "Luxury Nails - Spa (123456)"]);
    expect(id).toBe("id-2");
  });

  it("uploads with multipart/related and shares with named people only", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = fakeFetch((url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.includes("uploadType=multipart"))
        return {
          json: {
            id: "f1",
            name: "a.pdf",
            mimeType: "application/pdf",
            size: "3",
            webViewLink: "https://drive/f1",
          },
        };
      return { json: {} };
    });
    const drive = new DriveProvider(new GoogleAuth(cfg, "r", f));
    const stored = await drive.upload(
      { fileName: "a.pdf", mimeType: "application/pdf", data: Buffer.from("abc") },
      "folder1",
    );
    expect(stored).toEqual({
      id: "f1",
      name: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      webViewLink: "https://drive/f1",
    });
    expect(String(new Headers(calls[0]!.init!.headers).get("content-type"))).toMatch(
      /^multipart\/related; boundary=/,
    );

    await drive.shareWith("f1", ["subs@mazalfunders.com"]);
    const perm = calls.find((c) => c.url.includes("/permissions"))!;
    expect(JSON.parse(String(perm.init!.body))).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "subs@mazalfunders.com",
    });
  });

  it("retries a share with an invitation when the address has no Google account", async () => {
    const f = fakeFetch((url) =>
      url.includes("sendNotificationEmail=false")
        ? { status: 400, body: "notify required" }
        : { json: {} },
    );
    await new DriveProvider(new GoogleAuth(cfg, "r", f)).shareWith("f1", ["uw@lender.com"]);
    const perms = f.mock.calls.map((c) => c[0]).filter((u) => u.includes("/permissions"));
    expect(perms).toHaveLength(2);
    expect(perms[1]).toContain("sendNotificationEmail=true");
  });

  it("escapes quotes in Drive queries", () => {
    expect(driveQuoted("O'Brien's Deli")).toBe("'O\\'Brien\\'s Deli'");
  });
});
