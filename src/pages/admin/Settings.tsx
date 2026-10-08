import { useState, type FormEvent, type ReactNode } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import AuditLogs from './AuditLogs';
import FormBuilder from './FormBuilder';
import SlotManager from './SlotManager';
import ModulesTab from '../../components/settings/ModulesTab';
import TeamTab from '../../components/settings/TeamTab';
import { cn } from '../../lib/utils';
import { TIMEZONES, type AppSettings } from '../../types';

type Key = 'brand' | 'apps_script_url' | 'venue' | 'notifications' | 'timezone';

const TABS = [
  { key: 'brand', label: 'Brand' },
  { key: 'google', label: 'Google' },
  { key: 'venue', label: 'Venue' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'timezone', label: 'Time zone' },
  { key: 'team', label: 'Team' },
  { key: 'modules', label: 'Modules' },
  { key: 'forms', label: 'Forms' },
  { key: 'slots', label: 'Slots' },
  { key: 'audit', label: 'Audit logs' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const WIDE: Tab[] = ['forms', 'slots', 'audit']; // whole pages: they need the full width

/** Saves one app_settings row (PUT /api/settings sends only that key). The fields are the render function's job. */
function Panel<K extends Key>({ name, children }: { name: K; children: (form: AppSettings[K], set: (patch: Partial<AppSettings[K]>) => void) => ReactNode }) {
  const { settings, mutate } = useData();
  const [form, setForm] = useState(settings[name]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    mutate('/api/settings', 'PUT', { [name]: form }, 'Settings saved');
  };

  return (
    <form onSubmit={save} className="card space-y-4">
      {children(form, (patch) => setForm((current) => ({ ...current, ...patch })))}
      <button className="btn btn-primary">Save</button>
    </form>
  );
}

/** A button that calls an endpoint and shows it is working (test email, Apps Script ping). */
function TestButton({ label, busy, path, body, success }: { label: string; busy: string; path: string; body: unknown; success: string }) {
  const { mutate } = useData();
  const [working, setWorking] = useState(false);

  const run = async () => {
    setWorking(true);
    await mutate(path, 'POST', body, success);
    setWorking(false);
  };

  return <button type="button" className="btn" disabled={working} onClick={run}>{working ? busy : label}</button>;
}

export default function Settings() {
  const { settings } = useData();
  const page = usePageData();
  const [tab, setTab] = useState<Tab>('brand');
  // Re-created when the saved values change, so a form never shows stale ones.
  const fresh = (name: Key) => JSON.stringify(settings[name]);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div className={WIDE.includes(tab) ? undefined : 'max-w-2xl'}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">The back office: studio details, integrations, team, modules, forms, slots and audit logs.</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} className={cn('-mb-px border-b-2 px-3 py-2 font-medium', tab === key ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'brand' && (
        <Panel key={fresh('brand')} name="brand">
          {(form, set) => (
            <div>
              <label className="label">Studio name (used in emails)</label>
              <input className="input" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
          )}
        </Panel>
      )}

      {tab === 'google' && (
        <>
        <Panel key={fresh('apps_script_url')} name="apps_script_url">
          {(form, set) => (
            <>
              <div>
                <label className="label">Apps Script web app URL</label>
                <input className="input" type="url" placeholder="Leave empty to use VITE_APPS_SCRIPT_URL" value={form.url} onChange={(e) => set({ url: e.target.value })} />
                <p className="mt-1 text-xs text-ink-3">The script creates the Calendar event and Google Meet link for each booking. Deploy apps-script/main.gs as a web app and paste its /exec URL.</p>
              </div>
              <TestButton label="Test Apps Script" busy="Testing…" path="/api/trigger-apps-script" body={{ action: 'ping' }} success="Apps Script triggered" />
            </>
          )}
        </Panel>
        <section className="card mt-4 space-y-3">
          <h2 className="font-semibold">Excel sheet on SharePoint</h2>
          <p className="text-xs text-ink-3">Every booking and every change is written to its row in the studio's Excel workbook as it happens. If rows are missing (Microsoft was unreachable, or the sheet was edited by hand), this writes them all again. The dashboard tells you when it is done, or why it failed.</p>
          <TestButton label="Sync everything to Excel" busy="Starting…" path="/api/settings" body={{ action: 'sync-excel' }} success="Excel sync started" />
        </section>
        </>
      )}

      {tab === 'venue' && (
        <Panel key={fresh('venue')} name="venue">
          {(form, set) => (
            <div>
              <label className="label">Venue address (sent to clients booking in person)</label>
              <textarea className="input" rows={3} value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </div>
          )}
        </Panel>
      )}

      {tab === 'timezone' && (
        <Panel key={fresh('timezone')} name="timezone">
          {(form, set) => (
            <div>
              <label className="label">The studio's time zone</label>
              <select className="input" value={form.tz} onChange={(e) => set(TIMEZONES.find((z) => z.tz === e.target.value)!)}>
                {TIMEZONES.map((z) => <option key={z.tz} value={z.tz}>{z.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-3">Slot hours, emails, the calendar event and Excel all use this zone. Changing it moves every slot: hours set for 10:00 become 10:00 in the new zone, and sessions already booked keep their exact moment.</p>
            </div>
          )}
        </Panel>
      )}

      {tab === 'notifications' && (
        <Panel key={fresh('notifications')} name="notifications">
          {(form, set) => (
            <>
              <div>
                <label className="label">Send me a copy of every new booking at</label>
                <input className="input" type="email" placeholder="Leave empty for none" value={form.admin_email} onChange={(e) => set({ admin_email: e.target.value })} />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.send_confirmations} onChange={(e) => set({ send_confirmations: e.target.checked })} />
                Email clients a confirmation when they book
              </label>
              <div>
                <label className="label">Send a reminder this many hours before a session</label>
                <input className="input w-32" type="number" min={0} max={168} value={form.lead_time_hours} onChange={(e) => set({ lead_time_hours: Number(e.target.value) })} />
                <p className="mt-1 text-xs text-ink-3">The reminder email goes out once a day (about 11:30 am IST) to clients whose session starts within this time. 0 turns reminders off.</p>
              </div>
              <TestButton label="Send test email" busy="Sending…" path="/api/send-email" body={{ test: true }} success="Test emails sent to you: one from Gmail, one from Zoho" />
            </>
          )}
        </Panel>
      )}

      {tab === 'team' && <TeamTab />}
      {tab === 'modules' && <ModulesTab />}
      {tab === 'forms' && <FormBuilder />}
      {tab === 'slots' && <SlotManager />}
      {tab === 'audit' && <AuditLogs />}
    </div>
  );
}
