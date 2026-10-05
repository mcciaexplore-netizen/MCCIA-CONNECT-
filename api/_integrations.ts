import tls from 'node:tls';
import { createInterface } from 'node:readline';
import { HttpError, loadSettings } from './_lib.js';

/** client = mail to the people who book (sent from the Gmail account); internal = mail to staff: coordinators, the booking copy, tests (sent from the Zoho account). */
export type MailChannel = 'client' | 'internal';

interface Sender {
  host: string;
  user: string;
  pass: string;
}

// Google and Zoho show app passwords in groups of four; the spaces are not part of the password.
const secret = (value: string | undefined) => value?.replace(/\s/g, '');

/**
 * The account a channel sends from. While Zoho is not set up, internal mail goes out through Gmail instead
 * (with a warning), unless `strict` asks for an error, which is what the test email needs.
 */
function senderFor(channel: MailChannel, strict = false): Sender {
  const gmail = { host: 'smtp.gmail.com', user: process.env.GMAIL_USER, pass: secret(process.env.GMAIL_APP_PASSWORD) };
  const zoho = { host: process.env.ZOHO_SMTP_HOST || 'smtppro.zoho.in', user: process.env.ZOHO_USER, pass: secret(process.env.ZOHO_APP_PASSWORD) };
  const wanted = channel === 'client' ? gmail : zoho;
  if (wanted.user && wanted.pass) return wanted as Sender;
  if (channel === 'internal' && !strict && gmail.user && gmail.pass) {
    console.warn('Zoho is not configured (ZOHO_USER / ZOHO_APP_PASSWORD): sending staff mail through Gmail');
    return gmail as Sender;
  }
  throw new HttpError(500, channel === 'client' ? 'Email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' : 'Staff email is not configured (ZOHO_USER / ZOHO_APP_PASSWORD)');
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string; // sent as an alternative to the text
  strict?: boolean; // no Gmail fallback for internal mail
}

/**
 * Sends an email through SMTP (implicit TLS, app password), from the brand name in settings.
 * Uses Node's built-in tls so no mail library is needed.
 */
export async function sendMail(channel: MailChannel, { to, subject, text, html, strict }: Mail) {
  const sender = senderFor(channel, strict);
  if (/[\r\n<>]/.test(to)) throw new HttpError(400, 'Invalid recipient');
  const brand = (await loadSettings()).brand.name;

  const socket = tls.connect(465, sender.host);
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  socket.on('error', () => {}); // failures surface through the pending read below

  // Reads one (possibly multi-line) SMTP reply and checks its status code.
  const reply = async (code: string) => {
    let line: string;
    do {
      const next = await lines.next();
      if (next.done) throw new Error('SMTP connection closed unexpectedly');
      line = next.value;
    } while (line[3] === '-');
    if (!line.startsWith(code)) throw new Error(`SMTP error: ${line}`);
  };
  const send = async (command: string, code: string) => {
    socket.write(`${command}\r\n`);
    await reply(code);
  };

  const base64 = (value: string) => Buffer.from(value).toString('base64');
  const wrapped = (value: string) => (base64(value).match(/.{1,76}/g) ?? []).join('\r\n');
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', wrapped(body)];
  const boundary = `mccia-${crypto.randomUUID()}`;
  // Replies to client mail should reach the studio's real inbox, not the Gmail account that happens to send it.
  const replyTo = channel === 'client' && process.env.ZOHO_USER ? [`Reply-To: ${process.env.ZOHO_USER}`] : [];
  const message = [
    `From: =?UTF-8?B?${base64(brand)}?= <${sender.user}>`,
    `To: ${to}`,
    ...replyTo,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${sender.user.split('@')[1]}>`,
    'MIME-Version: 1.0',
    ...(html
      ? [`Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, ...part('text/plain', text), `--${boundary}`, ...part('text/html', html), `--${boundary}--`]
      : part('text/plain', text)),
  ].join('\r\n');

  try {
    await reply('220');
    await send('EHLO mccia-crm', '250');
    await send(`AUTH PLAIN ${base64(`\0${sender.user}\0${sender.pass}`)}`, '235');
    await send(`MAIL FROM:<${sender.user}>`, '250');
    await send(`RCPT TO:<${to}>`, '250');
    await send('DATA', '354');
    await send(`${message}\r\n.`, '250');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
  return sender.user; // who it was sent from, for the test email to report
}

// A booking waits this long for the script so the confirmation can carry the Meet link. The first call after the script has been
// idle takes several seconds longer (measured: about 9 s), so the default is generous; APPS_SCRIPT_TIMEOUT_MS overrides it.
const APPS_SCRIPT_TIMEOUT_MS = 20_000;

/**
 * POSTs a JSON body (e.g. { action: 'create', ticketNumber, ... }) to the Apps Script web app
 * (URL from settings, else VITE_APPS_SCRIPT_URL), adding APPS_SCRIPT_SECRET as `secret` when it is set.
 * Returns the script's JSON reply, or null when it replied with anything else.
 */
export async function triggerAppsScript(body: { action: string } & Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = (await loadSettings()).apps_script_url.url || process.env.VITE_APPS_SCRIPT_URL;
  if (!url) throw new HttpError(500, 'Apps Script URL is not set (Settings, or VITE_APPS_SCRIPT_URL)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(process.env.APPS_SCRIPT_SECRET ? { ...body, secret: process.env.APPS_SCRIPT_SECRET } : body),
    signal: AbortSignal.timeout(Number(process.env.APPS_SCRIPT_TIMEOUT_MS) || APPS_SCRIPT_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(502, `Apps Script responded with ${res.status}`);
  try {
    const reply = await res.json();
    return reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : null;
  } catch {
    return null;
  }
}

/** Why a reply from the Apps Script is not a success (an unreadable reply, or { success: false, error }), or null when it is fine. */
export function scriptFailure(reply: Record<string, unknown> | null): string | null {
  if (!reply) return 'the script did not answer with a readable reply (check the web app is deployed to "Anyone" and the URL is right)';
  return reply.success === false ? String(reply.error ?? 'no reason given') : null;
}
