import type { BookingMode, StudioZone } from '../src/types/index.js';

/** The wording of the emails the app sends. Every value that came from a form is escaped before it goes into HTML. */

const NAVY = '#003f8a';
const BLUE = '#0157b3';

/** A date and time as the studio writes it, in the studio's time zone, e.g. "Thursday, 8 October 2026 at 11:00 am (IST)". */
export const formatWhen = (date: Date, zone: StudioZone) => `${date.toLocaleString(zone.locale, { timeZone: zone.tz, dateStyle: 'full', timeStyle: 'short' })} (${zone.label})`;

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface BookingMail {
  brand: string;
  siteUrl: string; // the site's address, where the logo for HTML emails is served from
  zone: StudioZone;
  clientName: string;
  companyName: string;
  coordinatorName?: string;
  ticketNumber: string;
  moduleName: string;
  start: Date;
  mode: BookingMode;
  meetingLink: string | null;
  venue: string;
  linkProblem?: string; // why an online session has no Meet link (told to staff, never to the client)
}

const whereText = (b: BookingMail) =>
  b.mode === 'online' ? (b.meetingLink ? `Online. Join here: ${b.meetingLink}` : 'Online. The meeting link will be shared before the session.') : `In person: ${b.venue || b.brand}`;

const details = (b: BookingMail) => `When: ${formatWhen(b.start, b.zone)}\nWhere: ${whereText(b)}\nReference: ${b.ticketNumber}`;

// Staff see what the client cannot: that Google gave no link, why, and what to do.
const staffDetails = (b: BookingMail) =>
  details(b) + (b.mode === 'online' && !b.meetingLink ? `\nGoogle Meet: NOT created (${b.linkProblem ?? 'no reason given'}). Open the ticket and choose "Create Meet link".` : '');

/** The top of an HTML email: the MCCIA logo (public/mccia-logo.png) on white. The logo has no background, so a dark band would hide it. */
const logoBand = (b: BookingMail) =>
  `<div style="background:#ffffff;padding:20px;text-align:center;border-bottom:4px solid ${NAVY};"><img src="${esc(b.siteUrl)}/mccia-logo.png" alt="${esc(b.brand)}" width="160" height="43" style="display:inline-block;border:0;"></div>`;

interface ClientMessage {
  subject: string;
  lead: { text: string; html: string };
  where?: boolean; // show the Meet link / venue (not for a cancellation)
  extra?: [string, string][]; // more rows, e.g. the previous time of a rescheduled session
  closing?: string;
}

/** One email to the person who booked (sent from the Gmail account): the plain text and an HTML version with the same details. */
function clientMessage(b: BookingMail, { subject, lead, where = true, extra = [], closing = 'We look forward to seeing you.' }: ClientMessage) {
  const row = (label: string, value: string) => `<tr><td style="padding:8px;color:#6b7280;">${label}</td><td style="padding:8px;">${value}</td></tr>`;
  const place =
    b.mode === 'online'
      ? row('Meet link', b.meetingLink ? `<a href="${esc(b.meetingLink)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;">Join Google Meet</a>` : 'The link will be shared before the session.')
      : row('Venue', esc(b.venue || b.brand));
  const html =
    `<div style="font-family:Outfit,Arial,sans-serif;max-width:600px;color:#1a1f36;">` +
    logoBand(b) +
    `<div style="padding:24px;"><p>Hello ${esc(b.clientName)},</p><p>${lead.html}</p>` +
    `<table style="width:100%;border-collapse:collapse;">` +
    row('Reference', `<b style="color:${BLUE};">${esc(b.ticketNumber)}</b>`) +
    row('Date and time', esc(formatWhen(b.start, b.zone))) +
    extra.map(([label, value]) => row(esc(label), esc(value))).join('') +
    row('Mode', b.mode === 'online' ? 'Online (Google Meet)' : 'In person') +
    (where ? place : '') +
    `</table><p>${esc(closing)}</p></div>` +
    (b.venue ? `<div style="background:#e7ecf4;padding:14px;text-align:center;font-size:12px;color:#6b7280;">${esc(b.venue)}</div>` : '') +
    `</div>`;
  const facts = where ? details(b) : `When: ${formatWhen(b.start, b.zone)}\nReference: ${b.ticketNumber}`;
  const more = extra.map(([label, value]) => `\n${label}: ${value}`).join('');
  return { subject, text: `Hello ${b.clientName},\n\n${lead.text}\n\n${facts}${more}\n\n${closing}\n${b.brand}`, html };
}

const named = (b: BookingMail, text: (module: string) => string) => ({ text: text(b.moduleName), html: text(`<b>${esc(b.moduleName)}</b>`) });

/** The booking confirmation. */
export const clientConfirmation = (b: BookingMail) =>
  clientMessage(b, { subject: `Booking confirmed: ${b.moduleName} (${b.ticketNumber})`, lead: named(b, (m) => `Your ${m} session is confirmed.`) });

/** Follow-up for a confirmation that went out before the Meet link existed. */
export const clientLink = (b: BookingMail) =>
  clientMessage(b, { subject: `Your Google Meet link: ${b.moduleName} (${b.ticketNumber})`, lead: named(b, (m) => `Here is the Google Meet link for your ${m} session.`) });

/** The session was cancelled. */
export const clientCancelled = (b: BookingMail) =>
  clientMessage(b, {
    subject: `Session cancelled: ${b.moduleName} (${b.ticketNumber})`,
    lead: named(b, (m) => `Your ${m} session has been cancelled.`),
    where: false,
    closing: 'If you would like another time, simply book again or reply to this email.',
  });

/** The session moved to a new time (b.start is the new time). */
export const clientRescheduled = (b: BookingMail, previous: Date) =>
  clientMessage(b, {
    subject: `Session rescheduled: ${b.moduleName} (${b.ticketNumber})`,
    lead: named(b, (m) => `Your ${m} session has moved to a new time.`),
    extra: [['Previous time', formatWhen(previous, b.zone)]],
  });

/** Asks the client to rate their session on the feedback page. */
export function feedbackRequest(b: BookingMail, link: string) {
  const html =
    `<div style="font-family:Outfit,Arial,sans-serif;max-width:600px;color:#1a1f36;">` +
    logoBand(b) +
    `<div style="padding:24px;"><p>Hello ${esc(b.clientName)},</p>` +
    `<p>Thank you for your <b>${esc(b.moduleName)}</b> session on ${esc(formatWhen(b.start, b.zone))}. We would love to hear how it went: it takes a minute.</p>` +
    `<p style="text-align:center;margin:24px 0;"><a href="${esc(link)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;">Give feedback</a></p>` +
    `<p style="font-size:12px;color:#6b7280;">Reference ${esc(b.ticketNumber)}. The link works once.</p></div></div>`;
  return {
    subject: `How was your session? (${b.ticketNumber})`,
    text: `Hello ${b.clientName},\n\nThank you for your ${b.moduleName} session on ${formatWhen(b.start, b.zone)}. We would love to hear how it went: it takes a minute.\n\nGive feedback: ${link}\n\nReference ${b.ticketNumber}. The link works once.\n${b.brand}`,
    html,
  };
}

/** To the coordinator the booking was assigned to (sent from the Zoho account). */
export function coordinatorNotice(b: BookingMail) {
  return {
    subject: `New booking assigned: ${b.ticketNumber}`,
    text: `${b.coordinatorName ? `Hello ${b.coordinatorName},\n\n` : ''}A ${b.moduleName} session was booked for you.\n\nClient: ${b.clientName} (${b.companyName})\n${staffDetails(b)}`,
  };
}

/** To the address in Settings > Notifications (sent from the Zoho account). */
export function adminCopy(b: BookingMail) {
  return { subject: `New booking ${b.ticketNumber}: ${b.moduleName}`, text: `${b.clientName} (${b.companyName}) booked ${b.moduleName}.\n\n${staffDetails(b)}` };
}

/** To the coordinator: one of their sessions was cancelled. */
export function coordinatorCancelled(b: BookingMail, by: string) {
  return {
    subject: `Session cancelled: ${b.ticketNumber}`,
    text: `${b.coordinatorName ? `Hello ${b.coordinatorName},\n\n` : ''}The ${b.moduleName} session with ${b.clientName} (${b.companyName}) was cancelled by ${by}.\n\nWas: ${formatWhen(b.start, b.zone)}\nReference: ${b.ticketNumber}`,
  };
}

/** To the coordinator: one of their sessions moved (b.start is the new time). */
export function coordinatorRescheduled(b: BookingMail, previous: Date, by: string, reason: string) {
  return {
    subject: `Session rescheduled: ${b.ticketNumber}`,
    text: `${b.coordinatorName ? `Hello ${b.coordinatorName},\n\n` : ''}${by} moved the ${b.moduleName} session with ${b.clientName} (${b.companyName}).\n\nPrevious time: ${formatWhen(previous, b.zone)}\n${staffDetails(b)}\nReason: ${reason}`,
  };
}

/** What a coordinator is told about a client being assigned to them, or taken from them. */
export interface AssignmentMail {
  brand: string;
  coordinatorName: string;
  clientName: string;
  companyName: string;
  email: string;
  phone: string;
  openTickets: number;
  by: string;
  reason?: string;
  otherCoordinator?: string; // the previous one (to the new coordinator) or the new one (to the previous coordinator)
}

/** To the coordinator who now has the client. */
export function clientAssigned(m: AssignmentMail) {
  const first = !m.otherCoordinator;
  return {
    subject: first ? `You have been assigned a new client: ${m.clientName}` : `Client ${m.clientName} has been assigned to you`,
    text:
      `Hello ${m.coordinatorName},\n\n` +
      (first ? `${m.by} assigned you a new client.` : `${m.by} reassigned a client to you from ${m.otherCoordinator}.`) +
      `\n\nClient: ${m.clientName} (${m.companyName})\nEmail: ${m.email}\nPhone: ${m.phone}\nOpen tickets now with you: ${m.openTickets}` +
      (m.reason ? `\nReason: ${m.reason}` : '') +
      `\n\n${m.brand}`,
  };
}

/** To the coordinator the client was taken from. */
export function clientReassignedAway(m: AssignmentMail) {
  return {
    subject: `Client ${m.clientName} has been reassigned`,
    text: `Hello ${m.coordinatorName},\n\n${m.by} reassigned your client ${m.clientName} (${m.companyName}) to ${m.otherCoordinator}. Their open tickets and upcoming sessions moved with them.${m.reason ? `\n\nReason: ${m.reason}` : ''}\n\n${m.brand}`,
  };
}
