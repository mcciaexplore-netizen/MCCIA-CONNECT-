import type { InferSelectModel } from 'drizzle-orm';
import type { adminNotifications, auditLogs, bookings, clients, companies, coordinators, modules, slotConfig, tickets } from '../../api/_schema';

// ---------- constants shared by the browser and the API ----------

export const ROLES = ['super_admin', 'coordinator'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ['new', 'pending', 'follow_up', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** `new` reads "Scheduled": every ticket is a booked session. These are also the choices of the consultant form's Consultation Status. */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Scheduled',
  pending: 'Pending',
  follow_up: 'Follow Up',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  no_show: 'No Show',
};
export const statusOf = (label: string) => TICKET_STATUSES.find((status) => STATUS_LABELS[status] === label);

/** Shortest reason (characters) accepted when a ticket's coordinator is replaced by another. */
export const MIN_REASON_LENGTH = 20;

/** Statuses after which a ticket needs no more work. */
export const CLOSED_STATUSES: readonly TicketStatus[] = ['completed', 'cancelled', 'no_show'];

export const BOOKING_MODES = ['online', 'offline'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const PAYMENT_STATUSES = ['paid', 'unpaid', 'waived'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_LABELS: Record<PaymentStatus, string> = { paid: 'Paid', unpaid: 'Unpaid', waived: 'Waived' };

export const BOOKING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** checkbox = several choices (saved as "A, B"), url = a web address. */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'radio', 'checkbox', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** The field types that offer a list of options. */
export const CHOICE_TYPES: readonly FieldType[] = ['select', 'radio', 'checkbox'];

/** form_questions.form_type of the form clients fill in when booking. */
export const BOOKING_FORM = 'booking';
/** form_questions.form_type of the form staff fill in after the consultation. */
export const POST_CONSULTATION_FORM = 'post_consultation';

// ---------- JSON stored in jsonb columns ----------

/**
 * The star ratings (1-5) a client gives on the feedback page, stored in tickets.feedback_data under these keys.
 * `label` is the Excel header (columns U-X, the agreed format); `question` is what the client reads.
 */
export const FEEDBACK_FIELDS = [
  { key: 'understanding', label: 'Rate understanding level', question: 'Rate the understanding level of the consultant' },
  { key: 'solution', label: 'Rate solution/recommendation', question: 'Rate the solution / recommendation' },
  { key: 'value_addition', label: 'Rating of value addition', question: 'Rate the value addition' },
] as const;
/** feedback_data key of the client's "Additional Suggestions" (the fifth feedback field, free text, optional). */
export const FEEDBACK_COMMENTS = 'comments';
export const FEEDBACK_COMMENTS_LABEL = 'Additional Suggestions';
export const FEEDBACK_COMMENTS_HINT = 'Any suggestions or comments about your consultation experience?';
/** Longest feedback comment accepted. */
export const MAX_FEEDBACK_COMMENTS = 2000;

/** Fireflies recordings: a finished online session is looked for this many days, and Fireflies is not asked about it again within this many minutes. */
export const RECORDING_WINDOW_DAYS = 7;
export const RECORDING_RECHECK_MINUTES = 10;

/** One question on a module's booking or post-consultation form. */
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
}

const question = (id: string, label: string, type: FieldType, required = false, options: string[] = []): FormField => ({ id, label, type, required, options });

/**
 * Why an answer does not fit its question, if it does not: a list question (select, radio, checkbox) only takes its own options and a
 * url question a web address. The booking form, the consultant form and the API share this.
 */
export function answerProblem(question: FormField, value: string): 'option' | 'url' | undefined {
  if ((question.type === 'select' || question.type === 'radio') && !question.options.includes(value)) return 'option';
  if (question.type === 'checkbox' && !value.split(', ').every((option) => question.options.includes(option))) return 'option';
  if (question.type === 'url' && !/^https?:\/\/\S+$/i.test(value)) return 'url';
  return undefined;
}

/**
 * Two of the consultant form's fields are not stored with its answers but on the ticket itself: the form shows and saves them from there
 * (the ticket's status and payment follow their own rules). Answer id -> the ticket field that PATCH /api/tickets takes.
 */
export const TICKET_FIELDS = { consultation_status: 'status', payment_status: 'paymentStatus' } as const;
/** Fields only an admin may change (payment is recorded by hand by an admin); coordinators do not see them on the form. */
export const ADMIN_ONLY_FIELDS: readonly string[] = ['payment_status'];

/**
 * The consultant form (post-consultation notes): one form, one Save button, saved in tickets.post_consultation_data. Used for any module
 * that has no post_consultation row in form_questions yet; admins can change it per module in the Form builder. Excel columns read these by id.
 * (Additional Suggestions is not here: the client gives it on the feedback form.)
 */
export const DEFAULT_POST_CONSULTATION_QUESTIONS: FormField[] = [
  question('primary_goal', 'Primary Goal', 'select', false, ['Exploring AI implementation for the first time', 'AI strategy and roadmap planning', 'Need help with a specific AI project/problem', 'Scaling existing AI solutions']),
  question('ai_use_area', 'AI Use Area', 'checkbox', false, ['Workflow Automation', 'Data Management', 'Content Creation', 'Lead Generation', 'Finance & Accounting', 'R&D', 'Customer Support', 'HR & Recruitment', 'Other']),
  question('ai_urgency', 'AI Urgency', 'select', false, ['1-3 Months', '3-6 Months', 'Flexible/still exploring', 'Not Yet Determined']),
  question('ai_budget', 'Estimated Budget for AI', 'select', false, ['0-10,000', '10,000-50,000', '50,000-2,00,000', '2,00,000+', 'Not Yet Determined']),
  question('data_storage', 'Primary Data Storage', 'select', false, ['Paper registers/notebooks', 'Mix paper + Unorganised files', 'Unorganised Excel', 'Excel/Sheets (Organized)', 'Cloud storage (Drive/OneDrive)', 'ERP/CRM System']),
  question('business_communication', 'Business Communication', 'select', false, ['Phone/in-person only', 'Whatsapp groups', 'Whatsapp + email', 'Google Workspace/Office 365']),
  question('order_tracking', 'Customer/Order Tracking', 'select', false, ['Paper diary/order book', 'Excel contact/order list', 'CRM Software', 'ERP System']),
  question('accounting_gst', 'Accounting & GST', 'select', false, ['Manual books/Excel', 'Tally (offline)', 'Tally (online/cloud)', 'Cloud accounting software', 'ERP integrated accounting']),
  question('project_management', 'Project/Work Management', 'select', false, ['To-do lists/Excel trackers', 'Email threads/verbal', 'Google Workspace/Office 365', 'Project management software']),
  question('inventory_tracking', 'Production/Inventory Tracking', 'select', false, ['NA', 'Manual logs/physical count', 'Excel trackers updated daily', 'Inventory management software', 'ERP integrated']),
  question('data_decisions', 'Data Usage in Decisions', 'select', false, ['Pure gut feeling/experience', 'Past records/intuition', 'Basic Excel reports', 'Dashboard/BI tools', 'Predictive analytics']),
  question('ai_tool_usage', 'Current AI Tool Usage', 'select', false, ['Never used AI tools', 'Aware of ChatGPT but not used', 'Tried ChatGPT/basic AI tools', 'Regular AI usage (content/analysis)', 'Advanced AI integration in workflow']),
  question('system_integration', 'System Integration', 'select', false, ['All systems isolated', 'Manual data transfer', 'Some API connections', 'Fully integrated systems']),
  question('process_automation', 'Process Automation', 'select', false, ['No automation anywhere', '1-2 tasks automated', 'Partial automation', 'Most processes automated']),
  question('attendance_payroll', 'Attendance & Payroll Management', 'select', false, ['NA(Solo Entrepreneur)', 'Manual registers & calculation', 'Excel-based attendance & payroll', 'Biometric + payroll software', 'Integrated HR system']),
  question('tech_adoption', 'New Tech Adoption Rate', 'select', false, ['Very slow/resistant', 'Open to new tools', 'Actively adopting new tools', 'Early adopter/tech-forward']),
  question('dashboard_tools', 'Dashboard Tools', 'select', false, ['No Dashboards', 'Excel Charts', 'Power BI/Tableau', 'Custom Dashboards']),
  question('meeting_query', 'Meeting Query', 'textarea'),
  question('meeting_solution', 'Meeting Solution', 'textarea'),
  question('ai_level', 'AI Implementation Level', 'select', false, ['None', 'A : Basic AI Use', 'B : Complex AI Use', 'D : Application Deployed and Using', 'E : Application Under Development', 'Need to Confirm']),
  question('time_cost_hours', 'Time Cost (hours)', 'number'),
  question('money_cost_inr', 'Money Cost (INR)', 'number'),
  question('time_span_minutes', 'Time Span (minutes)', 'number'),
  question('payment_status', 'Payment Status', 'select', false, ['Paid', 'Unpaid', 'Waived']),
  question('recording_link', 'Recording Link', 'url'),
  question('testimonial_link', 'Testimonial Link', 'url'),
  question('consultation_status', 'Consultation Status', 'select', false, ['Scheduled', 'Completed', 'Cancelled', 'No Show', 'Rescheduled', 'Pending', 'Follow Up']),
];

/** slot_config.weekly_rules item: open hours on a weekday (0 = Sunday), times as "HH:mm" studio time. */
export interface WeeklyRule {
  day: number;
  start: string;
  end: string;
}

/** slot_config.date_overrides item: replaces the weekly rules for one date, or closes it. */
export interface DateOverride {
  date: string; // YYYY-MM-DD
  closed: boolean;
  start: string;
  end: string;
}

/** coordinators.availability: a coordinator's own hours, same shape as a service's. null = no personal limit (bookable whenever a service is open). */
export interface Availability {
  weeklyRules: WeeklyRule[];
  dateOverrides: DateOverride[];
}

/** tickets.internal_notes item. */
export interface InternalNote {
  text: string;
  author: string;
  at: string;
}

/** The studio's time zone: tz (IANA name) drives every calculation; label and offset are what people read. */
export interface StudioZone {
  tz: string;
  label: string;
  offset: string;
  locale: string; // how dates are written in emails, e.g. en-IN
}

/** app_settings rows, one key each. */
export interface AppSettings {
  brand: { name: string };
  apps_script_url: { url: string };
  venue: { address: string };
  notifications: { admin_email: string; send_confirmations: boolean; lead_time_hours: number }; // lead_time_hours: how long before a session the reminder goes out (0 = no reminders)
  timezone: StudioZone;
}

/** The zones offered in Settings > Time zone. The studio's slot hours are read in the chosen zone. */
export const TIMEZONES: (StudioZone & { name: string })[] = [
  { tz: 'Asia/Kolkata', label: 'IST', offset: '+05:30', locale: 'en-IN', name: 'India (IST, UTC+05:30)' },
  { tz: 'Asia/Dubai', label: 'GST', offset: '+04:00', locale: 'en-GB', name: 'Dubai (GST, UTC+04:00)' },
  { tz: 'Asia/Singapore', label: 'SGT', offset: '+08:00', locale: 'en-GB', name: 'Singapore (SGT, UTC+08:00)' },
  { tz: 'Asia/Tokyo', label: 'JST', offset: '+09:00', locale: 'en-GB', name: 'Tokyo (JST, UTC+09:00)' },
  { tz: 'Europe/London', label: 'UK time', offset: '+00:00', locale: 'en-GB', name: 'London (GMT / BST)' },
  { tz: 'Europe/Berlin', label: 'CET', offset: '+01:00', locale: 'en-GB', name: 'Central Europe (CET / CEST)' },
  { tz: 'America/New_York', label: 'ET', offset: '-05:00', locale: 'en-US', name: 'New York (ET)' },
  { tz: 'UTC', label: 'UTC', offset: '+00:00', locale: 'en-GB', name: 'UTC' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  brand: { name: 'MCCIA Pune AI Studio' },
  apps_script_url: { url: '' },
  venue: { address: '' },
  notifications: { admin_email: '', send_confirmations: true, lead_time_hours: 24 },
  timezone: (({ tz, label, offset, locale }) => ({ tz, label, offset, locale }))(TIMEZONES[0]),
};

/** The settings anyone may read (GET /api/settings?public=1): what the public pages and every role need. */
export type PublicSettings = Pick<AppSettings, 'brand' | 'venue' | 'timezone'>;

// ---------- rows (defined once in api/_schema.ts) ----------

// Over the wire (JSON) Dates become ISO strings.
type WireValue<V> = V extends Date ? string : V;
type Wire<T> = { [K in keyof T]: WireValue<T[K]> };

/** The transcript is left out: it is long and has its own request (GET /api/tickets?transcript=<id>). */
export type Ticket = Omit<Wire<InferSelectModel<typeof tickets>>, 'transcript'>;
export type Client = Wire<InferSelectModel<typeof clients>>;
export type Coordinator = Wire<InferSelectModel<typeof coordinators>>;
export type Booking = Wire<InferSelectModel<typeof bookings>>;
export type Company = Wire<InferSelectModel<typeof companies>>;
/** A company with its numbers, for the admin Companies page (GET /api/clients?companies=1). */
export type CompanyRow = Company & { clientCount: number; bookingCount: number; lastBooking: string | null };
export type AdminNotification = Wire<InferSelectModel<typeof adminNotifications>>;
export type AuditLog = Wire<InferSelectModel<typeof auditLogs>>;
export type SlotConfig = Wire<InferSelectModel<typeof slotConfig>>;
/** questions = the booking form, postQuestions = the post-consultation form (defaults when not customised). */
export type Module = Wire<InferSelectModel<typeof modules>> & { questions: FormField[]; postQuestions: FormField[] };

/** A booking together with its ticket (built in DataContext). */
export interface Session {
  booking: Booking;
  ticket: Ticket;
}

// ---------- API payloads ----------

/** The client fields collected on every booking and edited on the client profile. */
export interface ClientInput {
  companyName: string;
  personName: string;
  email: string;
  phone: string;
  jobTitle: string;
  scale: string;
  industry: string; // the form calls it "Sector" (the column kept its first name)
  udyamNo: string;
  acquisitionFrom: string;
  isMember: boolean;
  membershipId: string;
  district: string;
  gender: string;
  category: string;
  subSector: string;
  employmentRange: string; // a whole number
  onlinePresence: string;
}

export const BLANK_CLIENT: ClientInput = {
  companyName: '',
  personName: '',
  email: '',
  phone: '',
  jobTitle: '',
  scale: '',
  industry: '',
  udyamNo: '',
  acquisitionFrom: '',
  isMember: false,
  membershipId: '',
  district: '',
  gender: '',
  category: '',
  subSector: '',
  employmentRange: '',
  onlinePresence: '',
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shortest password accepted for any login (admins and coordinators). */
export const MIN_PASSWORD_LENGTH = 8;

// The choices on the booking form (stored as the label).
export const ACQUISITION_OPTIONS = ['Whatsapp Group', 'Email Marketing', 'Word of Mouth', 'Helpline Reference', 'Cold Call', 'Walk-in', 'Referral', 'Social Media', 'Event', 'Other'] as const;
export const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const;
export const CATEGORY_OPTIONS = ['General', 'OBC', 'SC', 'ST'] as const;
export const SCALE_OPTIONS = ['Micro (Turnover less than INR 10Cr)', 'Small (Turnover less than INR 100 Cr)', 'Medium (Turnover less than INR 500 Cr)', 'Large (Turnover more than INR 500 Cr)'] as const;
export const SECTOR_OPTIONS = ['Manufacturing', 'Services', 'Agriculture', 'Others'] as const;
export const ONLINE_PRESENCE_OPTIONS = [
  'No website/social media/Google Business',
  'Google Business/Whatsapp Business',
  'Basic Website/ 2+ social platforms',
  'Professional website + social media',
  'E-commerce enabled website',
] as const;

export type ClientFieldType = 'text' | 'email' | 'tel' | 'number' | 'select' | 'member';
export interface ClientField {
  key: keyof ClientInput;
  label: string;
  type: ClientFieldType;
  required: boolean;
  options?: readonly string[];
  placeholder?: string;
}

/**
 * The 17 fixed booking-form fields, in the order clients see them and the Excel lists them. The admin cannot remove or change them
 * (the Form builder only adds questions below). `member` is the Member / Non-Member choice (clients.is_member); the Membership ID after it
 * is only asked of members. Everything that shows or exports client details reads this list.
 */
export const CLIENT_FIELDS: ClientField[] = [
  { key: 'companyName', label: 'Company Name', type: 'text', required: true },
  { key: 'udyamNo', label: 'UDYAM No', type: 'text', required: false },
  { key: 'personName', label: 'Person Name', type: 'text', required: true },
  { key: 'phone', label: 'Contact / Phone', type: 'tel', required: true, placeholder: '10-digit mobile number' },
  { key: 'email', label: 'Email ID', type: 'email', required: true },
  { key: 'isMember', label: 'Member / Non-Member', type: 'member', required: true },
  { key: 'membershipId', label: 'Membership ID', type: 'text', required: false },
  { key: 'acquisitionFrom', label: 'Acquisition From', type: 'select', required: true, options: ACQUISITION_OPTIONS },
  { key: 'district', label: 'District', type: 'text', required: true },
  { key: 'gender', label: 'Gender', type: 'select', required: true, options: GENDER_OPTIONS },
  { key: 'category', label: 'Category', type: 'select', required: true, options: CATEGORY_OPTIONS },
  { key: 'scale', label: 'Scale', type: 'select', required: true, options: SCALE_OPTIONS },
  { key: 'industry', label: 'Sector', type: 'select', required: true, options: SECTOR_OPTIONS },
  { key: 'subSector', label: 'Sub-Sector', type: 'text', required: true },
  { key: 'jobTitle', label: 'Job Title', type: 'text', required: true },
  { key: 'employmentRange', label: 'Employment Range', type: 'number', required: true },
  { key: 'onlinePresence', label: 'Online Presence', type: 'select', required: true, options: ONLINE_PRESENCE_OPTIONS },
];

/** A client detail as text (a client row or the form's values): "Member" / "Non-Member" for the member flag, empty when not given. */
type ClientLike = { [K in keyof ClientInput]?: ClientInput[K] | number | null };
export function clientText(client: ClientLike, key: keyof ClientInput) {
  const value = client[key];
  if (key === 'isMember') return value ? 'Member' : 'Non-Member';
  return value == null ? '' : String(value);
}

/** A 10-digit phone number from what was typed (spaces, dashes, +91 / 91 / 0 prefixes allowed), or null. */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * What is wrong with the client details on a booking (empty when fine). The browser and the API share this. `complete` (the default) asks for
 * every required field of CLIENT_FIELDS; a client already on file (their details are locked, or may predate the newer fields) is only held
 * to the basic contact details.
 */
export function validateClient(client: ClientInput, complete = true) {
  const errors: Partial<Record<keyof ClientInput, string>> = {};
  // The API passes whatever JSON it was sent: anything that is not text counts as empty.
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  if (!text(client.companyName)) errors.companyName = 'Company name is required';
  if (!text(client.personName)) errors.personName = 'Person name is required';
  if (!text(client.email)) errors.email = 'Email is required';
  else if (!EMAIL_PATTERN.test(text(client.email))) errors.email = 'Enter a valid email address';
  if (!text(client.phone)) errors.phone = 'Phone is required';
  else if (!normalizePhone(text(client.phone))) errors.phone = 'Enter a 10-digit phone number';
  if (!text(client.jobTitle)) errors.jobTitle = 'Job title is required';
  if (!complete) return errors;

  for (const { key, label, type, required, options } of CLIENT_FIELDS) {
    if (errors[key] || type === 'member') continue;
    const value = type === 'number' && typeof client[key] === 'number' ? String(client[key]) : text(client[key]); // a number field may arrive as a JSON number
    if (!value) {
      if (required) errors[key] = `${label} is required`;
    } else if (options && !options.includes(value)) errors[key] = `Choose a valid ${label}`;
    else if (key === 'employmentRange' && !/^\d{1,7}$/.test(value)) errors[key] = 'Enter a whole number';
  }
  return errors;
}

/** An admin login, as Settings > Team lists it (GET /api/auth/users). */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

/** One line of a client's coordinator history (GET /api/clients?history=<clientId>). */
export interface CoordinatorHistoryEntry {
  id: string;
  coordinator: string;
  from: string | null; // the coordinator they replaced, when it was a reassignment
  assignedBy: string;
  at: string;
  reason: string | null;
}

/** What the public booking page may see of a module (and the venue it shows for in-person sessions). */
export type PublicModule = Pick<Module, 'id' | 'slug' | 'name' | 'description' | 'color' | 'questions'> & { venue: string };
/** What a booking page's address answers for a module that is switched off (not a 404): the page says so and shows who to contact. */
export interface DisabledModule {
  disabled: true;
  contactEmail: string;
}

/** What the landing page lists: the live booking pages, and the studio address for its footer. */
export interface LandingData {
  modules: Pick<Module, 'id' | 'slug' | 'name' | 'description' | 'color'>[];
  venue: string;
}

/** A slot the studio offers, with the modes (online/offline) that still have room. No modes = fully booked. */
export interface SlotInfo {
  startsAt: string;
  endsAt: string;
  modes: BookingMode[];
}

/** One row of a coordinator's calendar (GET /api/slots?coordinator=): a slot they can still be booked in, or one of their sessions. */
export interface CoordinatorSlot {
  startsAt: string;
  endsAt: string;
  state: 'available' | 'booked';
  services: string[]; // available: the services that can still be booked in this slot
  booking?: { ticketId: string; ticketNumber: string; clientName: string; companyName: string; moduleName: string; mode: BookingMode; status: BookingStatus };
}

/**
 * What POST /api/bookings answers (200, nothing booked) when a client's own coordinator is busy at that time: the coordinators who are free
 * then. The client can book with one of them once (the company's coordinator does not change) or pick another time.
 */
export interface BookingConflict {
  coordinatorConflict: true;
  assignedCoordinator: { id: string; name: string };
  availableCoordinators: { id: string; name: string; color: string }[];
}

export interface BookingResult {
  bookingId: string;
  ticketId: string;
  ticketNumber: string;
}

/** What the public feedback page shows (GET /api/feedback/:token). */
export interface FeedbackForm {
  brand: string;
  clientName: string;
  moduleName: string;
  ticketNumber: string;
  sessionAt: string;
  zone: StudioZone;
}

/** One page of the audit log (GET /api/audit-logs): newest first, `nextCursor` asks for the next page. */
export interface AuditPage {
  logs: AuditLog[];
  nextCursor: string | null;
  actions: string[]; // every action in the log, for the filter
  people: string[]; // everyone who appears in it
}

export interface BookingSummary {
  id: string;
  ticketNumber: string;
  moduleName: string;
  clientName: string;
  startsAt: string;
  endsAt: string;
  mode: BookingMode;
  meetingLink: string | null;
  venue: string;
  clientEmail: string; // partly hidden: ab***@example.com
  confirmationEmail: boolean; // whether the studio sends confirmation emails
}
