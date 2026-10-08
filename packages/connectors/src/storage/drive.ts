import { randomBytes } from "node:crypto";
import { GoogleApiError, type GoogleAuth } from "../google/auth";
import type { Attachment, StorageProvider, StoredFile } from "../types";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,webViewLink";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
}

function toStored(f: DriveFile): StoredFile {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.size ? Number(f.size) : null,
    webViewLink: f.webViewLink ?? null,
  };
}

/** Drive query string literal: escape backslashes and single quotes. */
export function driveQuoted(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Folder names cannot contain "/" in the CRM's path model; keep them readable. */
export function safeFolderName(s: string): string {
  return s.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

/**
 * Google Drive storage with the `drive.file` scope: the CRM can only see files and folders it
 * created, which keeps the rest of Ascend's Drive private to the app.
 */
export class DriveProvider implements StorageProvider {
  readonly name = "google-drive";

  constructor(private readonly auth: GoogleAuth) {}

  async findFolder(name: string, parentId: string): Promise<string | null> {
    const q = [
      `name = ${driveQuoted(name)}`,
      `mimeType = '${FOLDER}'`,
      `${driveQuoted(parentId)} in parents`,
      "trashed = false",
    ].join(" and ");
    const r = await this.auth.json<{ files: DriveFile[] }>(
      `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    );
    return r.files[0]?.id ?? null;
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    const r = await this.auth.json<DriveFile>(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return r.id;
  }

  async ensureFolderPath(path: string[], rootId = "root"): Promise<string> {
    let parent = rootId;
    for (const raw of path) {
      const name = safeFolderName(raw);
      parent = (await this.findFolder(name, parent)) ?? (await this.createFolder(name, parent));
    }
    return parent;
  }

  async upload(file: Attachment, folderId: string): Promise<StoredFile> {
    const boundary = `mca_${randomBytes(8).toString("hex")}`;
    const meta = JSON.stringify({ name: file.fileName, parents: [folderId] });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await this.auth.json<DriveFile>(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    return toStored(r);
  }

  async download(fileId: string): Promise<Buffer> {
    const res = await this.auth.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Renames a file or folder (e.g. a deal folder once the merchant's real name is known). */
  async rename(fileId: string, name: string): Promise<void> {
    await this.auth.json<DriveFile>(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: safeFolderName(name) }),
    });
  }

  async list(folderId: string): Promise<StoredFile[]> {
    const q = `${driveQuoted(folderId)} in parents and trashed = false and mimeType != '${FOLDER}'`;
    const out: StoredFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.auth.json<{ files: DriveFile[]; nextPageToken?: string }>(
        `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(${FIELDS})&orderBy=name&pageSize=100` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      );
      out.push(...r.files.map(toStored));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async shareWith(fileId: string, emails: string[]): Promise<void> {
    for (const emailAddress of emails) {
      const grant = (notify: boolean) =>
        this.auth.request(
          `${API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=${notify}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "user", role: "reader", emailAddress }),
          },
        );
      try {
        await grant(false);
      } catch (err) {
        // Google requires a notification email when the address has no Google account; the
        // lender then opens the file through that invitation. Still a named grant, never a
        // public link.
        if (!(err instanceof GoogleApiError && err.status === 400)) throw err;
        await grant(true);
      }
    }
  }
}

/** Standard per-deal folder layout under the CRM root folder. */
export const DEAL_SUBFOLDERS = [
  "Application",
  "Statements",
  "MTD",
  "Stips",
  "Contracts",
  // Team-only files (AI Risk Report); never offered for a lender package.
  "Internal",
] as const;
export type DealSubfolder = (typeof DEAL_SUBFOLDERS)[number];

export function dealFolderPath(merchantName: string, dealId: string): string[] {
  return ["Ascend CRM", "Deals", `${safeFolderName(merchantName)} (${dealId.slice(-6)})`];
}
