// Getting a draft out of the conversation and into a mail client.
//
// Two exits, and the ordering between them is the design.
//
// `.eml` is the primary one. It is a real RFC 5322 message: every mail client
// opens it, it carries recipients, headers and (later) attachments, it survives
// being saved, and it does not care how long the body is.
//
// `mailto:` is the convenience shortcut, and its limits are hard enough to be
// worth stating rather than discovering:
//   - practical URL ceiling around 2000 characters, past which clients TRUNCATE
//     silently — the user sends a letter with the end missing and no warning
//   - no attachments, at all
//   - plain text only
//   - newline encoding varies between clients
//   - on a desktop with no mail client registered, clicking it does nothing,
//     and reports nothing
//
// So the composer offers both and says which is which, rather than shipping the
// shortcut and calling the feature done.
//
// Neither path sends anything. Sending needs a credential, and the framework
// holding one would break the rule Transport already keeps.

import type { EmailCard } from "../cards/types.js";

/** Roughly where mail clients start truncating a mailto: URL. */
export const MAILTO_SAFE_LENGTH = 2000;

const encode = (s: string) =>
  // encodeURIComponent leaves these legal-in-a-query characters alone, and
  // some clients read them as delimiters. Percent-encoding them costs nothing.
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type MailtoLink = {
  href: string;
  /** True when the href is long enough that a client may cut it short. */
  mayTruncate: boolean;
  length: number;
};

export function buildMailto(email: EmailCard): MailtoLink {
  const params: string[] = [];
  if (email.cc?.length) params.push(`cc=${encode(email.cc.join(","))}`);
  if (email.bcc?.length) params.push(`bcc=${encode(email.bcc.join(","))}`);
  if (email.subject) params.push(`subject=${encode(email.subject)}`);
  // CRLF rather than LF: clients disagree about a bare %0A, and every one of
  // them understands %0D%0A.
  if (email.body) params.push(`body=${encode(email.body.replace(/\r?\n/g, "\r\n"))}`);

  const href = `mailto:${encode(email.to.join(","))}${params.length ? `?${params.join("&")}` : ""}`;
  return { href, length: href.length, mayTruncate: href.length > MAILTO_SAFE_LENGTH };
}

/** RFC 2047 encoded-word, so a non-ASCII subject survives the header. */
function encodeHeader(value: string): string {
  if (!/[^\x20-\x7e]/.test(value)) return value;
  const b64 = typeof btoa === "function"
    ? btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    : Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * An RFC 5322 message.
 *
 * Deliberately without a Date or Message-ID: this is a DRAFT, and stamping it
 * with a send time it did not have would be a small lie that some clients then
 * display as fact. The user's own client fills both in when they send.
 */
export function buildEml(email: EmailCard): string {
  const lines = [
    `To: ${email.to.join(", ")}`,
    ...(email.cc?.length ? [`Cc: ${email.cc.join(", ")}`] : []),
    ...(email.bcc?.length ? [`Bcc: ${email.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    email.body,
  ];
  // CRLF throughout — the spec's line ending, and the one strict parsers want.
  return lines.join("\r\n").replace(/(?<!\r)\n/g, "\r\n");
}

/** A filename that will not upset a filesystem. */
export function emlFilename(email: EmailCard): string {
  const stem = (email.subject || "draft").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${stem || "draft"}.eml`;
}
