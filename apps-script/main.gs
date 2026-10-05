/**
 * Booking system: Google Apps Script web app.
 * Creates the Calendar event and the Google Meet link for a booking. It sends no email:
 * the main app emails clients (from Gmail) and staff (from Zoho). Excel files are made by the main app too.
 *
 * SETUP
 *  1. Services (+): add the "Google Calendar API" (identifier: Calendar, v3). Or push appsscript.json with clasp.
 *  2. Project Settings > Script properties:
 *       API_BASE_URL   your Vercel URL, e.g. https://mccia-connect.vercel.app   (to save the Meet link back)
 *       SHARED_SECRET  a long random string; set the same value as APPS_SCRIPT_SECRET in Vercel
 *  3. Run the function "authorize" once and allow the permissions it asks for.
 *  4. Deploy > New deployment > Web app: Execute as "Me", access "Anyone".
 *     Put the /exec URL in Settings > Google (or VITE_APPS_SCRIPT_URL).
 *
 * The web app URL is public, so set SHARED_SECRET: with it, a request that does not carry the secret is refused.
 *
 * REQUEST  { action: 'create' | 'reschedule' | 'cancel' | 'ping', secret, ...fields }
 *   create:     ticketNumber, moduleSlug, moduleName, clientName, clientEmail, coordinatorEmail,
 *               startTime, endTime (ISO), mode ('online' | 'offline'), venueAddress, bookingId,
 *               timeZone (e.g. Asia/Kolkata), brandName
 *   reschedule: the create fields plus oldEventId
 *   cancel:     eventId
 * REPLY    { success, ... }. For create: eventId, meetingLink ('' when offline).
 */

const MEET_ATTEMPTS = 5; // the Meet link can take a moment to appear after the event is created

/**
 * Run this ONCE from the editor (choose "authorize" in the function list, then Run) before deploying.
 * It makes Google ask you to allow Calendar and web requests; without that, every booking fails with
 * "You do not have permission to call calendar.events.insert". After allowing, deploy a NEW VERSION.
 */
function authorize() {
  Calendar.CalendarList.list({ maxResults: 1 });
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    checkSecret(data);
    switch (data.action) {
      case 'create':
        return json(createBooking(data));
      case 'reschedule':
        return json(rescheduleBooking(data));
      case 'cancel':
        return json(cancelBooking(data));
      case 'ping':
        return json({ success: true });
      default:
        return json({ success: false, error: 'Unknown action: ' + data.action });
    }
  } catch (err) {
    console.error(err);
    return json({ success: false, error: String((err && err.message) || err) });
  }
}

function checkSecret(data) {
  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (secret && data.secret !== secret) throw new Error('Not allowed');
}

function createBooking(data, requestSuffix) {
  const online = data.mode === 'online';

  // One calendar event for every booking; online ones also ask Google for a Meet conference.
  const resource = {
    summary: data.moduleName + ' - ' + data.clientName + ' | ' + data.ticketNumber,
    description: buildDescription(data),
    location: online ? '' : data.venueAddress || '',
    start: { dateTime: data.startTime, timeZone: zoneOf(data) },
    end: { dateTime: data.endTime, timeZone: zoneOf(data) },
    attendees: [data.clientEmail, data.coordinatorEmail].filter(Boolean).map(function (email) {
      return { email: email };
    }),
  };
  if (online) {
    resource.conferenceData = {
      createRequest: { requestId: data.bookingId + (requestSuffix || ''), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const event = Calendar.Events.insert(resource, 'primary', { conferenceDataVersion: 1, sendUpdates: 'none' });

  let meetLink = online ? meetLinkOf(event) : '';
  for (let attempt = 1; online && !meetLink && attempt < MEET_ATTEMPTS; attempt++) {
    Utilities.sleep(1000);
    meetLink = meetLinkOf(Calendar.Events.get('primary', event.id));
  }

  // Save the link in the database (the web app also reads it from this reply; this covers a reply that arrives too late).
  tryTo(function () {
    writeMeetLinkBack(data.bookingId, meetLink, event.id);
  });

  return { success: true, eventId: event.id, meetingLink: meetLink };
}

/** The studio's time zone, sent with every request from Settings; the script's own zone only if it is missing. */
function zoneOf(data) {
  return data.timeZone || Session.getScriptTimeZone();
}

function meetLinkOf(event) {
  if (event.hangoutLink) return event.hangoutLink;
  const points = (event.conferenceData && event.conferenceData.entryPoints) || [];
  const video = points.filter(function (point) { return point.entryPointType === 'video'; })[0];
  return video ? video.uri : '';
}

/** Tells the web app the Meet link and event id (POST /api/bookings with action 'update-meet'). */
function writeMeetLinkBack(bookingId, meetLink, eventId) {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('API_BASE_URL');
  if (!base) return;
  const response = UrlFetchApp.fetch(base.replace(/\/+$/, '') + '/api/bookings', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ action: 'update-meet', bookingId: bookingId, meetLink: meetLink, eventId: eventId, secret: props.getProperty('SHARED_SECRET') }),
  });
  if (response.getResponseCode() >= 400) console.error('Saving the Meet link failed: HTTP ' + response.getResponseCode());
}

/** Replaces the old event with a new one (the new event gets its own Meet link). */
function rescheduleBooking(data) {
  if (data.oldEventId) {
    tryTo(function () { Calendar.Events.remove('primary', data.oldEventId); });
  }
  return createBooking(data, '-' + new Date().getTime());
}

function cancelBooking(data) {
  if (data.eventId) {
    try {
      Calendar.Events.remove('primary', data.eventId);
    } catch (err) {
      const message = String((err && err.message) || err);
      // An event that is already gone is fine; any other failure is reported, so the app can tell staff to delete it by hand.
      if (!/not found|has been deleted|\b(404|410)\b/i.test(message)) {
        console.error(err);
        return { success: false, error: message };
      }
    }
  }
  return { success: true };
}

function buildDescription(data) {
  return 'Ticket: ' + data.ticketNumber + '\nClient: ' + data.clientName + '\nMode: ' + data.mode + '\nBooked via ' + (data.brandName || 'the booking system');
}

/** Runs fn; a failure is logged and never stops the booking. Returns whether it worked. */
function tryTo(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function json(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
