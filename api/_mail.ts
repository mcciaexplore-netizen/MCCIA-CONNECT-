import type { BookingMode } from '../src/types/index.js';

/** The wording of the emails the booking sends. Every value that came from a form is escaped before it goes into HTML. */

const NAVY = '#003f8a';
const BLUE = '#0157b3';

export const formatWhen = (date: Date) => date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface BookingMail {
  brand: string;
  clientName: string;
  companyName: string;
  coordinatorName?: string;
  ticketNumber: string;
  moduleName: string;
  start: Date;
  mode: BookingMode;
  meetingLink: string | null;
  venue: string;
}

const whereText = (b: BookingMail) =>
  b.mode === 'online' ? (b.meetingLink ? `Online. Join here: ${b.meetingLink}` : 'Online. The meeting link will be shared before the session.') : `In person: ${b.venue || b.brand}`;

const details = (b: BookingMail) => `When: ${formatWhen(b.start)} (IST)\nWhere: ${whereText(b)}\nReference: ${b.ticketNumber}`;

/** To the person who booked (sent from the Gmail account): the plain text and an HTML version with the same details. */
export function clientConfirmation(b: BookingMail) {
  const row = (label: string, value: string) => `<tr><td style="padding:8px;color:#6b7280;">${label}</td><td style="padding:8px;">${value}</td></tr>`;
  const where =
    b.mode === 'online'
      ? row('Meet link', b.meetingLink ? `<a href="${esc(b.meetingLink)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;">Join Google Meet</a>` : 'The link will be shared before the session.')
      : row('Venue', esc(b.venue || b.brand));
  const html =
    `<div style="font-family:Outfit,Arial,sans-serif;max-width:600px;color:#1a1f36;">` +
    `<div style="background:${NAVY};padding:20px;text-align:center;"><h2 style="color:#ffffff;margin:0;">${esc(b.brand)}</h2></div>` +
    `<div style="padding:24px;"><p>Hello ${esc(b.clientName)},</p><p>Your <b>${esc(b.moduleName)}</b> session is confirmed.</p>` +
    `<table style="width:100%;border-collapse:collapse;">` +
    row('Reference', `<b style="color:${BLUE};">${esc(b.ticketNumber)}</b>`) +
    row('Date and time', `${esc(formatWhen(b.start))} (IST)`) +
    row('Mode', b.mode === 'online' ? 'Online (Google Meet)' : 'In person') +
    where +
    `</table><p>We look forward to seeing you.</p></div>` +
    `<div style="background:#e7ecf4;padding:14px;text-align:center;font-size:12px;color:#6b7280;">${esc(b.venue || b.brand)}</div></div>`;
  return {
    subject: `Booking confirmed: ${b.moduleName} (${b.ticketNumber})`,
    text: `Hello ${b.clientName},\n\nYour ${b.moduleName} session is confirmed.\n\n${details(b)}\n\nWe look forward to seeing you.\n${b.brand}`,
    html,
  };
}

/** To the coordinator the booking was assigned to (sent from the Zoho account). */
export function coordinatorNotice(b: BookingMail) {
  return {
    subject: `New booking assigned: ${b.ticketNumber}`,
    text: `${b.coordinatorName ? `Hello ${b.coordinatorName},\n\n` : ''}A ${b.moduleName} session was booked for you.\n\nClient: ${b.clientName} (${b.companyName})\n${details(b)}`,
  };
}

/** To the address in Settings > Notifications (sent from the Zoho account). */
export function adminCopy(b: BookingMail) {
  return { subject: `New booking ${b.ticketNumber}: ${b.moduleName}`, text: `${b.clientName} (${b.companyName}) booked ${b.moduleName}.\n\n${details(b)}` };
}
