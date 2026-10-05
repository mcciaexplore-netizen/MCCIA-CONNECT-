import tls from 'node:tls';
import { createInterface } from 'node:readline';
import { HttpError, loadSettings } from './_lib.js';

/**
 * Sends a plain-text email through Gmail SMTP (implicit TLS, app password), from the brand name in settings.
 * Uses Node's built-in tls so no mail library is needed.
 */
export async function sendMail(to: string, subject: string, text: string) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new HttpError(500, 'Email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD)');
  if (/[\r\n<>]/.test(to)) throw new HttpError(400, 'Invalid recipient');
  const brand = (await loadSettings()).brand.name;

  const socket = tls.connect(465, 'smtp.gmail.com');
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
  const message = [
    `From: =?UTF-8?B?${base64(brand)}?= <${user}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    (base64(text).match(/.{1,76}/g) ?? []).join('\r\n'),
  ].join('\r\n');

  try {
    await reply('220');
    await send('EHLO mccia-crm', '250');
    await send(`AUTH PLAIN ${base64(`\0${user}\0${pass}`)}`, '235');
    await send(`MAIL FROM:<${user}>`, '250');
    await send(`RCPT TO:<${to}>`, '250');
    await send('DATA', '354');
    await send(`${message}\r\n.`, '250');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}

const APPS_SCRIPT_TIMEOUT_MS = 8000; // a booking should not hang on a slow script

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
    signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(502, `Apps Script responded with ${res.status}`);
  try {
    return await res.json();
  } catch {
    return null;
  }
}
