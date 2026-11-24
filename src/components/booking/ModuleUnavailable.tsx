import Icon from '../ui/Icon';

/** What a booking page shows for a module that is switched off: who to contact instead. */
export default function ModuleUnavailable({ contactEmail }: { contactEmail: string }) {
  return (
    <div className="card mx-auto my-10 max-w-md space-y-3 px-8 py-12 text-center">
      <Icon name="alert" className="mx-auto h-10 w-10 text-ink-3" />
      <h1 className="text-xl font-semibold">This module is currently unavailable.</h1>
      <p className="text-ink-2">Please contact MCCIA Pune for assistance.</p>
      {contactEmail && <a href={`mailto:${contactEmail}`} className="block font-medium text-primary hover:underline">{contactEmail}</a>}
    </div>
  );
}
