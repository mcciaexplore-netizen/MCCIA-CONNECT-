import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  AppSettings,
  Availability,
  BookingMode,
  BookingStatus,
  DateOverride,
  FormField,
  InternalNote,
  PaymentStatus,
  Role,
  TicketStatus,
  WeeklyRule,
} from '../src/types/index.js';

/**
 * Mirrors the SQL that was run in the Neon console, which is the source of truth for the database.
 * Do not use `drizzle-kit push` with this file. Columns that have a DB default (created_at, is_active,
 * status, ...) are typed non-null because the default always fills them; so are the foreign keys that
 * the app always sets.
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const modules = pgTable('modules', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color').notNull().default('#C41E3A'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/** Everyone who can sign in: admins and coordinators. Passwords are stored hashed (see _auth.ts). */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').$type<Role>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/** auth_user_id is the coordinator's users row (their login). Admins have no coordinators row. */
export const coordinators = pgTable('coordinators', {
  id: id(),
  authUserId: uuid('auth_user_id'),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  color: text('color').notNull().default('#C41E3A'),
  initials: text('initials'),
  isActive: boolean('is_active').notNull().default(true),
  availability: jsonb('availability').$type<Availability | null>(), // their own hours; null = no personal limit
  createdAt: createdAt(),
});

/**
 * A company, whoever from it books. Names match without capitals, punctuation or words like "Pvt" and "Ltd" (the normalize_company_name()
 * function in the database is the one rule for that). assigned_coordinator_id is the company's coordinator; every client of the company
 * shares it (clients.assigned_coordinator_id is kept in step with it).
 */
export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  nameNormalized: text('name_normalized').notNull().unique(),
  assignedCoordinatorId: uuid('assigned_coordinator_id').references(() => coordinators.id),
  createdAt: createdAt(),
});

export const clients = pgTable('clients', {
  id: id(),
  companyName: text('company_name').notNull(),
  personName: text('person_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  scale: text('scale'),
  industry: text('industry'),
  udyamNo: text('udyam_no'),
  jobTitle: text('job_title'),
  isMember: boolean('is_member').notNull().default(false),
  membershipId: text('membership_id'),
  acquisitionFrom: text('acquisition_from'),
  assignedCoordinatorId: uuid('assigned_coordinator_id').references(() => coordinators.id),
  companyId: uuid('company_id').references(() => companies.id),
  createdAt: createdAt(),
});

/** There is no slots table: open slots are computed from slot_config minus these bookings. */
export const bookings = pgTable('bookings', {
  id: id(),
  moduleId: uuid('module_id').notNull().references(() => modules.id),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  coordinatorId: uuid('coordinator_id').references(() => coordinators.id),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  mode: text('mode').$type<BookingMode>().notNull(),
  meetingLink: text('meeting_link'),
  googleEventId: text('google_event_id'),
  excelRowNumber: integer('excel_row_number'),
  bookingAnswers: jsonb('booking_answers').$type<Record<string, string>>().notNull().default({}),
  status: text('status').$type<BookingStatus>().notNull().default('scheduled'),
  createdBy: text('created_by').notNull().default('client'),
  reminderSent: boolean('reminder_sent').notNull().default(false), // the "your session is coming up" email has gone out
  meetLinkRequestedAt: timestamp('meet_link_requested_at', { withTimezone: true }), // when the Apps Script was last asked for a Meet link
  meetLinkFailedNotified: boolean('meet_link_failed_notified').notNull().default(false), // the admin was told the link never came
  recordingLink: text('recording_link'), // the session's Fireflies page (video, audio, transcript), saved once Fireflies has transcribed it
  recordingCheckedAt: timestamp('recording_checked_at', { withTimezone: true }), // when Fireflies was last asked, so it is not asked again at once
  createdAt: createdAt(),
});

export const tickets = pgTable('tickets', {
  id: id(),
  // Filled by the generate_ticket_number() trigger: TKT-0001 ..., one number per company (its name without capitals or extra spaces,
  // kept in company_ticket_numbers). Every session a company books is its own ticket row with the company's number, so it is not unique.
  ticketNumber: text('ticket_number').notNull().default(sql`''`),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  moduleId: uuid('module_id').notNull().references(() => modules.id),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  coordinatorId: uuid('coordinator_id').references(() => coordinators.id),
  // Set when the session was booked with a stand-in because the company's coordinator was busy: after the session the ticket goes back to them.
  followUpCoordinatorId: uuid('follow_up_coordinator_id').references(() => coordinators.id),
  status: text('status').$type<TicketStatus>().notNull().default('new'),
  postConsultationData: jsonb('post_consultation_data').$type<Record<string, string>>().notNull().default({}),
  internalNotes: jsonb('internal_notes').$type<InternalNote[]>().notNull().default([]),
  feedbackData: jsonb('feedback_data').$type<Record<string, string>>().notNull().default({}),
  // The Fireflies transcript of the session. Long, so the ticket list never carries it: it is read on its own (GET /api/tickets?transcript=).
  transcript: text('transcript'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  paymentStatus: text('payment_status').$type<PaymentStatus>().notNull().default('unpaid'), // set by an admin
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const coordinatorAssignments = pgTable('coordinator_assignments', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  coordinatorId: uuid('coordinator_id').notNull().references(() => coordinators.id),
  assignedBy: uuid('assigned_by'),
  isCurrent: boolean('is_current').notNull().default(true),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coordinatorReassignments = pgTable('coordinator_reassignments', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  fromCoordinatorId: uuid('from_coordinator_id').references(() => coordinators.id),
  toCoordinatorId: uuid('to_coordinator_id').notNull().references(() => coordinators.id),
  reason: text('reason').notNull(),
  doneBy: uuid('done_by'),
  companyId: uuid('company_id').references(() => companies.id), // set when the whole company changed coordinator
  createdAt: createdAt(),
});

/** Messages for the admin dashboard (for example a company that was auto-assigned a coordinator), until dismissed. */
export const adminNotifications = pgTable('admin_notifications', {
  id: id(),
  message: text('message').notNull(),
  companyId: uuid('company_id').references(() => companies.id),
  createdAt: createdAt(),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  action: text('action').notNull(),
  oldValue: jsonb('old_value').$type<Record<string, unknown>>(),
  newValue: jsonb('new_value').$type<Record<string, unknown>>(),
  doneByName: text('done_by_name'),
  role: text('role'),
  createdAt: createdAt(),
});

/** One row per (module, form_type). The app uses form_type = 'booking'. */
export const formQuestions = pgTable('form_questions', {
  id: id(),
  moduleId: uuid('module_id').notNull().references(() => modules.id),
  formType: text('form_type').notNull(),
  questions: jsonb('questions').$type<FormField[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const slotConfig = pgTable('slot_config', {
  id: id(),
  moduleId: uuid('module_id').notNull().unique().references(() => modules.id),
  weeklyRules: jsonb('weekly_rules').$type<WeeklyRule[]>().notNull().default([]),
  dateOverrides: jsonb('date_overrides').$type<DateOverride[]>().notNull().default([]),
  bufferBefore: integer('buffer_before').notNull().default(0),
  bufferAfter: integer('buffer_after').notNull().default(0),
  minNotice: integer('min_notice').notNull().default(60),
  slotIncrement: integer('slot_increment').notNull().default(60),
  maxParallel: integer('max_parallel').notNull().default(1),
  onlineCapacity: integer('online_capacity').notNull().default(1),
  offlineCapacity: integer('offline_capacity').notNull().default(1),
  maxAdvanceDays: integer('max_advance_days').notNull().default(60), // how far ahead a session can be booked
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<AppSettings[keyof AppSettings]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rate limiting: one row per (action, ip). `attempts` counts within the window that began at `window_start`
 * (action 'login' = failed sign-ins, action 'booking' = public bookings). `email` is the last address tried.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    action: text('action').notNull(),
    ip: text('ip').notNull(),
    email: text('email'),
    attempts: integer('attempts').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('login_attempts_action_ip').on(t.action, t.ip)],
);

/** A one-time link that lets a client rate their session (/feedback/:token) without signing in. */
export const feedbackTokens = pgTable('feedback_tokens', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  token: uuid('token').notNull().unique().defaultRandom(),
  used: boolean('used').notNull().default(false),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
