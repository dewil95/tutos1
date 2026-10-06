/**
 * Minimal Google OAuth 2.0 for one Workspace mailbox (funding@ascendfund.co). The CRM is an
 * "Internal" OAuth app in Ascend's own Google Cloud project, so restricted Gmail scopes need no
 * Google verification. Uses plain fetch to avoid the very large googleapis package.
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConsentUrl(
  cfg: GoogleOAuthConfig,
  state: string,
  loginHint?: string,
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenResponse> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new GoogleApiError(
      res.status,
      `${json.error ?? "token_error"}: ${json.error_description ?? ""}`,
    );
  }
  return json;
}

export async function exchangeCode(
  cfg: GoogleOAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
    fetchImpl,
  );
}

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Holds a refresh token and hands out cached access tokens. */
export class GoogleAuth {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
    private readonly refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const t = await tokenRequest(
      new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
      this.fetchImpl,
    );
    this.token = { value: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  /** Authorised JSON/bytes request against a Google API; throws GoogleApiError on non-2xx. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await this.accessToken()}`);
    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GoogleApiError(
        res.status,
        `${init.method ?? "GET"} ${url.split("?")[0]} → ${res.status} ${body.slice(0, 300)}`,
      );
    }
    return res;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    return (await (await this.request(url, init)).json()) as T;
  }
}
