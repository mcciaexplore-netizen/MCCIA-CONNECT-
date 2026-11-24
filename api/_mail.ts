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
  end: Date;
  mode: BookingMode;
  meetingLink: string | null;
  venue: string;
  contactEmail: string; // who clients may write to (Settings > Notifications), may be empty
  linkProblem?: string; // why an online session has no Meet link (told to staff, never to the client)
}

/** What the email says about the Meet link when it will arrive on its own, in its own email. */
const LINK_LATER = 'Will be sent to your email within a few minutes.';

const whereText = (b: BookingMail, linkLater = false) =>
  b.mode === 'online'
    ? linkLater ? `Online. Google Meet link: ${LINK_LATER}` : b.meetingLink ? `Online. Join here: ${b.meetingLink}` : 'Online. The meeting link will be shared before the session.'
    : `In person: ${b.venue || b.brand}`;

const details = (b: BookingMail, linkLater = false) => `When: ${formatWhen(b.start, b.zone)}\nWhere: ${whereText(b, linkLater)}\nReference: ${b.ticketNumber}`;

// Staff see what the client cannot: that Google gave no link, why, and what to do.
const staffDetails = (b: BookingMail) =>
  details(b) + (b.mode === 'online' && !b.meetingLink ? `\nGoogle Meet: NOT created (${b.linkProblem ?? 'no reason given'}). Open the ticket and choose "Create Meet link".` : '');

/** The top of an HTML email: the MCCIA logo (public/mccia-logo.png) on white. The logo has no background, so a dark band would hide it. */
const logoBand = (b: BookingMail) =>
  `<div style="background:#ffffff;padding:20px;text-align:center;border-bottom:4px solid ${NAVY};"><img src="${esc(b.siteUrl)}/mccia-logo.png" alt="${esc(b.brand)}" width="160" height="43" style="display:inline-block;border:0;"></div>`;

const row = (label: string, value: string) => `<tr><td style="padding:8px;color:#6b7280;">${label}</td><td style="padding:8px;">${value}</td></tr>`;
const venueBand = (b: BookingMail) => (b.venue ? `<div style="background:#e7ecf4;padding:14px;text-align:center;font-size:12px;color:#6b7280;">${esc(b.venue)}</div>` : '');

interface ClientMessage {
  subject: string;
  lead: { text: string; html: string };
  where?: boolean; // show the Meet link / venue (not for a cancellation)
  linkLater?: boolean; // an online session's link comes in its own email: say so instead of showing it
  extra?: [string, string][]; // more rows, e.g. the previous time of a rescheduled session
  closing?: string;
}

/** One email to the person who booked (sent from the Gmail account): the plain text and an HTML version with the same details. */
function clientMessage(b: BookingMail, { subject, lead, where = true, linkLater = false, extra = [], closing = 'We look forward to seeing you.' }: ClientMessage) {
  const place =
    b.mode === 'online'
      ? linkLater
        ? row('Google Meet link', LINK_LATER)
        : row('Meet link', b.meetingLink ? `<a href="${esc(b.meetingLink)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;">Join Google Meet</a>` : 'The link will be shared before the session.')
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
    venueBand(b) +
    `</div>`;
  const facts = where ? details(b, linkLater) : `When: ${formatWhen(b.start, b.zone)}\nReference: ${b.ticketNumber}`;
  const more = extra.map(([label, value]) => `\n${label}: ${value}`).join('');
  return { subject, text: `Hello ${b.clientName},\n\n${lead.text}\n\n${facts}${more}\n\n${closing}\n${b.brand}`, html };
}

const named = (b: BookingMail, text: (module: string) => string) => ({ text: text(b.moduleName), html: text(`<b>${esc(b.moduleName)}</b>`) });

/** The booking confirmation. An online session's Meet link is in it when Google had made one; if not, it says the link follows in its own email. */
export const clientConfirmation = (b: BookingMail) =>
  clientMessage(b, { subject: `Booking confirmed: ${b.moduleName} (${b.ticketNumber})`, lead: named(b, (m) => `Your ${m} session is confirmed.`), linkLater: b.mode === 'online' && !b.meetingLink });

/** The Meet link, in its own email, the moment it exists: for a link that was not ready when the confirmation went out, or was asked for later. */
export function clientLink(b: BookingMail) {
  const minutes = Math.round((b.end.getTime() - b.start.getTime()) / 60_000);
  const html =
    `<div style="font-family:Outfit,Arial,sans-serif;max-width:600px;color:#1a1f36;">` +
    logoBand(b) +
    `<div style="padding:24px;"><p>Dear ${esc(b.clientName)},</p><p>Your Google Meet link is ready. Click below to join your session.</p>` +
    `<table style="width:100%;border-collapse:collapse;">${row('Module', esc(b.moduleName))}${row('Date &amp; Time', esc(formatWhen(b.start, b.zone)))}${row('Duration', `${minutes} minutes`)}</table>` +
    `<p style="text-align:center;margin:28px 0;"><a href="${esc(b.meetingLink ?? '')}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:bold;">Join Google Meet</a></p>` +
    (b.contactEmail ? `<p style="font-size:13px;color:#6b7280;">If you have questions contact ${esc(b.contactEmail)}.</p>` : '') +
    `</div>` +
    venueBand(b) +
    `</div>`;
  const text =
    `Dear ${b.clientName},\n\nYour Google Meet link is ready. Click below to join your session.\n\n` +
    `Module: ${b.moduleName}\nDate & Time: ${formatWhen(b.start, b.zone)}\nDuration: ${minutes} minutes\nReference: ${b.ticketNumber}\n\n` +
    `Join Google Meet: ${b.meetingLink}\n` +
    (b.contactEmail ? `\nIf you have questions contact ${b.contactEmail}.\n` : '') +
    `\n${b.brand}`;
  return { subject: `Your Google Meet link — ${b.ticketNumber}`, text, html };
}

/** Sent ahead of a session (Settings > Notifications says how far ahead). */
export const clientReminder = (b: BookingMail) =>
  clientMessage(b, { subject: `Reminder: ${b.moduleName} session (${b.ticketNumber})`, lead: named(b, (m) => `This is a reminder that your ${m} session is coming up.`) });

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

/** To the coordinator when the Google Meet link of one of their sessions has been created (Zoho account). */
export function coordinatorLinkReady(b: BookingMail) {
  return {
    subject: `Meet link ready — ${b.ticketNumber}`,
    text: `The Google Meet link for ${b.clientName} / ${b.companyName} on ${formatWhen(b.start, b.zone)} is ready.\nLink: ${b.meetingLink}\nTicket: ${b.ticketNumber}`,
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

/** The Pre-Development Brief's 18 questions (App details are asked for separately, up front), grouped the way the source document groups them. */
const PRE_DEV_BRIEF_SECTIONS: { heading: string; questions: { q: string; hint: string }[] }[] = [
  {
    heading: 'A. Users and access',
    questions: [
      { q: 'Who will use this app?', hint: 'List every type of person who will log in (for example: owner, sales staff, dispatch clerk, customer, accountant). Include people who only view reports.' },
      { q: 'What will each user type mainly do?', hint: 'One or two lines per user type: their main tasks in the app on a normal day.' },
      { q: 'What can each user type do and NOT do?', hint: 'Think about who may create, edit, delete or approve records, see prices or money, and see other people’s data.' },
      { q: 'How should users log in?', hint: 'Phone number with OTP, email and password, Google account, a shared login on one device, or no login for some users?' },
    ],
  },
  {
    heading: 'B. The core workflow',
    questions: [
      { q: 'What is the ONE most important thing this app must do?', hint: 'If the app could do only one thing well, what would it be?' },
      { q: 'Walk me through one complete task step-by-step.', hint: 'Use a real example from start to finish: who does what, in what order, which tools are used today (paper, Excel, WhatsApp), and what the final result is. Mention what is painful about it.' },
    ],
  },
  {
    heading: 'C. Features',
    questions: [
      { q: 'What are the MUST-HAVE features for day one?', hint: 'Only features without which the app is useless on launch day. Keep this list short.' },
      { q: 'What features would be nice to have later?', hint: 'Good ideas that can wait for a second version.' },
    ],
  },
  {
    heading: 'D. Data and integrations',
    questions: [
      { q: 'What information needs to be stored?', hint: 'Customers, products, orders, invoices, photos, documents, and so on. Mention important fields (for example GST number, vehicle number) and any files that will be uploaded.' },
      { q: 'Does the app need to connect to any external services?', hint: 'WhatsApp, SMS, email, payments (UPI, Razorpay), Tally, Google Sheets, maps, GST or e-invoice portals. Write “None” if not needed.' },
      { q: 'Details about these integrations', hint: 'For each service above: what should happen, when, and who is involved. Skip if that answer was “None”.' },
    ],
  },
  {
    heading: 'E. Rules and automation',
    questions: [{ q: 'Does anything need approval before it happens? What should happen automatically?', hint: 'Examples: discounts above a limit need owner approval; an invoice is sent automatically on dispatch; a payment reminder goes out after 7 days.' }],
  },
  {
    heading: 'F. Usage and budget',
    questions: [
      { q: 'Where will users primarily use this app?', hint: 'Phone, desktop or tablet? Office, shop floor or on the road? Is internet slow or unreliable, and does the app need to work offline?' },
      { q: 'Approximately how many people will use this app?', hint: 'Users today and in 12 months, and how many might use it at the same time.' },
      { q: 'Do you have a monthly budget for this app?', hint: 'Running costs per month in ₹ (hosting, messaging, tools). “Zero, free tools only” is a valid answer.' },
    ],
  },
  {
    heading: 'G. Brand and success',
    questions: [
      { q: 'Do you have existing branding or design preferences?', hint: 'Logo, brand colours, fonts, and examples of apps or websites you like or dislike.' },
      { q: 'How will you know this app is working well for your business?', hint: 'Make it measurable: time saved per invoice, fewer errors, orders handled per day. Add today’s number if you know it.' },
      { q: 'Anything else we should know?', hint: 'Deadlines, compliance needs, existing software, languages (English, Hindi, Marathi), or anything we did not ask.' },
    ],
  },
];

/**
 * To an Applet Setup or AI Consultation client: the Pre-Development Brief's questions (so they can start answering right from the email) and
 * a link to the full document, which also has the AI prompt system the team builds the app with. A consultant sends this once they judge the build custom.
 */
export function preDevBrief(b: BookingMail, briefUrl: string) {
  const subject = `Pre-Development Brief: ${b.moduleName} (${b.ticketNumber})`;
  const intro = `Before we start building your application, please fill in the Pre-Development Brief below together with your team (30 to 45 minutes). "I don't know yet" is a valid answer for anything you are unsure of.`;
  const appDetails = 'App details: business name, app working name, contact person and role, prepared by, date.';

  let n = 0;
  const textSections = PRE_DEV_BRIEF_SECTIONS.map((s) => `${s.heading}\n${s.questions.map((item) => `${++n}. ${item.q}\n   ${item.hint}`).join('\n')}`).join('\n\n');
  n = 0;
  const htmlSections = PRE_DEV_BRIEF_SECTIONS.map(
    (s) =>
      `<h3 style="margin:20px 0 8px;font-size:14px;color:${NAVY};">${esc(s.heading)}</h3>` +
      s.questions.map((item) => `<p style="margin:0 0 12px;"><b>${++n}. ${esc(item.q)}</b><br><span style="color:#6b7280;font-size:13px;">${esc(item.hint)}</span></p>`).join(''),
  ).join('');

  const text = `Hello ${b.clientName},\n\n${intro}\n\n${appDetails}\n\n${textSections}\n\nThe full brief, together with the AI prompt system our team uses to turn your answers into the project's technical documents, is here: ${briefUrl}\n\nReference: ${b.ticketNumber}\n\n${b.brand}`;
  const html =
    `<div style="font-family:Outfit,Arial,sans-serif;max-width:640px;color:#1a1f36;">` +
    logoBand(b) +
    `<div style="padding:24px;"><p>Hello ${esc(b.clientName)},</p><p>${esc(intro)}</p>` +
    `<p style="margin:16px 0 4px;color:#6b7280;font-size:13px;">${esc(appDetails)}</p>` +
    htmlSections +
    `<p style="text-align:center;margin:28px 0;"><a href="${esc(briefUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;">Download the full brief</a></p>` +
    `<p style="font-size:12px;color:#6b7280;">It also has the AI prompt system our team uses to turn your answers into the project's technical documents. Reference ${esc(b.ticketNumber)}.</p>` +
    `</div></div>`;
  return { subject, text, html };
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

/** To the coordinator a brand-new company was given to automatically (it was their turn). */
export function clientAutoAssigned(m: Pick<AssignmentMail, 'brand' | 'coordinatorName' | 'clientName' | 'companyName' | 'email' | 'phone'>) {
  return {
    subject: `New client auto-assigned to you: ${m.companyName}`,
    text:
      `Hello ${m.coordinatorName},\n\n` +
      `${m.companyName} booked its first session and was assigned to you automatically, because it was your turn for a new company.` +
      `From now on every booking from this company comes to you.\n\n` +
      `Contact: ${m.clientName}\nEmail: ${m.email}\nPhone: ${m.phone}\n\n${m.brand}`,
  };
}

/** To the coordinator the client was taken from. */
export function clientReassignedAway(m: AssignmentMail) {
  return {
    subject: `Client ${m.clientName} has been reassigned`,
    text: `Hello ${m.coordinatorName},\n\n${m.by} reassigned your client ${m.clientName} (${m.companyName}) to ${m.otherCoordinator}. Their open tickets and upcoming sessions moved with them.${m.reason ? `\n\nReason: ${m.reason}` : ''}\n\n${m.brand}`,
  };
}
