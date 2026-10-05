import type { InferSelectModel } from 'drizzle-orm';
import type { auditLogs, bookings, clients, coordinators, modules, slotConfig, tickets } from '../../api/_schema';

// ---------- constants shared by the browser and the API ----------

export const ROLES = ['super_admin', 'coordinator'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ['new', 'pending', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  no_show: 'No show',
};

/** Shortest reason (characters) accepted when a ticket's coordinator is replaced by another. */
export const MIN_REASON_LENGTH = 20;

/** Statuses after which a ticket needs no more work. */
export const CLOSED_STATUSES: readonly TicketStatus[] = ['completed', 'cancelled', 'no_show'];

export const BOOKING_MODES = ['online', 'offline'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const BOOKING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'radio'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** form_questions.form_type of the form clients fill in when booking. */
export const BOOKING_FORM = 'booking';
/** form_questions.form_type of the form staff fill in after the consultation. */
export const POST_CONSULTATION_FORM = 'post_consultation';

// ---------- JSON stored in jsonb columns ----------

/** The star ratings (1-5) a client gives, stored in tickets.feedback_data under these keys. They fill Excel columns U-X. */
export const FEEDBACK_FIELDS = [
  { key: 'understanding', label: 'Rate understanding level' },
  { key: 'solution', label: 'Rate solution/recommendation' },
  { key: 'response_time', label: 'Response time rate' },
  { key: 'value_addition', label: 'Rating of value addition' },
] as const;

/** One question on a module's booking or post-consultation form. */
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
}

const question = (id: string, label: string, type: FieldType, required = false, options: string[] = []): FormField => ({ id, label, type, required, options });

/** Used for any module that has no post_consultation row in form_questions yet. Admins can edit them in the Form builder. */
export const DEFAULT_POST_CONSULTATION_QUESTIONS: FormField[] = [
  question('meeting_query', 'Meeting Query', 'textarea', true),
  question('meeting_solution', 'Meeting Solution', 'textarea', true),
  question('ramp_type', 'RAMP / Non-RAMP', 'radio', false, ['RAMP', 'Non-RAMP']),
  question('interaction_status', 'Interaction Status', 'select', true, ['Resolved', 'Follow-up required', 'Referred onward', 'No outcome']),
  question('value_addition', 'Value Addition', 'textarea'),
  question('additional_suggestions', 'Additional Suggestions', 'textarea'),
  question('ai_level', 'AI Implementation Level', 'select', false, ['Not started', 'Exploring', 'Pilot', 'Partially implemented', 'Fully implemented']),
  question('ai_use_description', 'AI Use Description', 'textarea'),
  question('active_user', 'Active User', 'radio', false, ['Yes', 'No']),
  question('time_cost_hours', 'Time Cost (hours)', 'number'),
  question('money_cost_inr', 'Money Cost (INR)', 'number'),
  question('testimonial_link', 'Testimonial Link', 'text'),
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

/** tickets.internal_notes item. */
export interface InternalNote {
  text: string;
  author: string;
  at: string;
}

/** app_settings rows, one key each. */
export interface AppSettings {
  brand: { name: string };
  apps_script_url: { url: string };
  venue: { address: string };
  notifications: { admin_email: string; send_confirmations: boolean };
  excel: { file_path: string };
}

export const DEFAULT_SETTINGS: AppSettings = {
  brand: { name: 'MCCIA Pune AI Studio' },
  apps_script_url: { url: '' },
  venue: { address: '' },
  notifications: { admin_email: '', send_confirmations: true },
  excel: { file_path: 'mccia-bookings.xlsx' },
};

// ---------- rows (defined once in api/_schema.ts) ----------

// Over the wire (JSON) Dates become ISO strings.
type WireValue<V> = V extends Date ? string : V;
type Wire<T> = { [K in keyof T]: WireValue<T[K]> };

export type Ticket = Wire<InferSelectModel<typeof tickets>>;
export type Client = Wire<InferSelectModel<typeof clients>>;
export type Coordinator = Wire<InferSelectModel<typeof coordinators>>;
export type Booking = Wire<InferSelectModel<typeof bookings>>;
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
  industry: string;
  udyamNo: string;
  acquisitionFrom: string;
  isMember: boolean;
  membershipId: string;
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
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The choices on the booking form (stored as the label).
export const SCALE_OPTIONS = ['Micro', 'Small', 'Medium', 'Large', 'Enterprise'] as const;
export const INDUSTRY_OPTIONS = ['Manufacturing', 'IT', 'Healthcare', 'Education', 'Agriculture', 'Retail', 'Finance', 'Other'] as const;
export const ACQUISITION_OPTIONS = ['Walk-in', 'Online', 'Referral', 'Event', 'Social Media', 'Other'] as const;

/** A 10-digit phone number from what was typed (spaces, dashes, +91 / 91 / 0 prefixes allowed), or null. */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** What is wrong with the client details on a booking (empty when fine). The browser and the API share this. */
export function validateClient(client: ClientInput) {
  const errors: Partial<Record<keyof ClientInput, string>> = {};
  if (!client.companyName.trim()) errors.companyName = 'Company name is required';
  if (!client.personName.trim()) errors.personName = 'Person name is required';
  if (!client.email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_PATTERN.test(client.email.trim())) errors.email = 'Enter a valid email address';
  if (!client.phone.trim()) errors.phone = 'Phone is required';
  else if (!normalizePhone(client.phone)) errors.phone = 'Enter a 10-digit phone number';
  if (!client.jobTitle.trim()) errors.jobTitle = 'Job title is required';
  return errors;
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

export interface BookingResult {
  bookingId: string;
  ticketId: string;
  ticketNumber: string;
  meetingLink: string | null; // set when the Apps Script created the Meet link in time
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
