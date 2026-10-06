import { randomBytes } from "node:crypto";
import type { OutboundEmail } from "../types";

/** RFC 2047 encoded-word for non-ASCII header values (merchant names with accents, etc.). */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Quoted file name for Content-Disposition, RFC 2231 for non-ASCII. */
function fileNameParams(name: string): string {
  const safe = name.replace(/[\r\n"\\]/g, "_");
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return `filename="${safe}"`;
  return `filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function wrapBase64(data: Buffer): string {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function assertHeaderSafe(v: string, field: string) {
  if (/[\r\n]/.test(v)) throw new Error(`header injection attempt in ${field}`);
}

/**
 * Builds an RFC 5322 message with a text body and attachments. Only From/To/Cc are written as
 * address headers — a Bcc header is never produced.
 */
export function buildMime(
  msg: OutboundEmail,
  boundary = `mca_${randomBytes(12).toString("hex")}`,
): string {
  for (const a of [msg.from, ...msg.to, ...msg.cc]) assertHeaderSafe(a, "address");
  assertHeaderSafe(msg.subject, "subject");
  if (msg.inReplyTo) assertHeaderSafe(msg.inReplyTo, "In-Reply-To");
  if (msg.to.length === 0) throw new Error("email needs at least one To recipient");

  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to.join(", ")}`,
    ...(msg.cc.length ? [`Cc: ${msg.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`, `References: ${msg.inReplyTo}`] : []),
    `X-MCA-Correlation-Id: ${msg.correlationId.replace(/[^\w.-]/g, "")}`,
    "MIME-Version: 1.0",
  ];

  const textPart = [
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(msg.text, "utf8")),
  ].join("\r\n");

  const attachments = msg.attachments ?? [];
  if (attachments.length === 0 && !msg.html) {
    return [...headers, textPart].join("\r\n");
  }

  const parts: string[] = [textPart];
  if (msg.html) {
    parts.push(
      [
        `Content-Type: text/html; charset="UTF-8"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(Buffer.from(msg.html, "utf8")),
      ].join("\r\n"),
    );
  }
  for (const a of attachments) {
    assertHeaderSafe(a.mimeType, "attachment mime type");
    parts.push(
      [
        `Content-Type: ${a.mimeType}; name="${a.fileName.replace(/[\r\n"\\]/g, "_")}"`,
        `Content-Disposition: attachment; ${fileNameParams(a.fileName)}`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(a.data),
      ].join("\r\n"),
    );
  }

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
