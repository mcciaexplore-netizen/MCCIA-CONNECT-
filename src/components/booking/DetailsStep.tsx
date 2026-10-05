import { useState, type FormEvent } from 'react';
import ClientFields from '../ui/ClientFields';
import QuestionFields from '../ui/QuestionFields';
import { validateClient, type ClientInput, type FormField } from '../../types';

interface Props {
  questions: FormField[];
  client: ClientInput;
  onClient: (client: ClientInput) => void;
  answers: Record<string, string>;
  onAnswers: (answers: Record<string, string>) => void;
  lockClient?: boolean; // an existing client: their details are shown but only changed on their profile
  onBack?: () => void;
  onNext: () => void;
}

/** The 10 client details and the module's questions. Next only goes on when everything required is filled in. */
export default function DetailsStep({ questions, client, onClient, answers, onAnswers, lockClient, onBack, onNext }: Props) {
  const [clientErrors, setClientErrors] = useState<Partial<Record<keyof ClientInput, string>>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});

  const next = (e: FormEvent) => {
    e.preventDefault();
    const problems = validateClient(client);
    const missing = Object.fromEntries(questions.filter((q) => q.required && !answers[q.id]?.trim()).map((q) => [q.id, `${q.label} is required`]));
    setClientErrors(problems);
    setAnswerErrors(missing);
    if (!Object.keys(problems).length && !Object.keys(missing).length) onNext();
  };

  return (
    <form onSubmit={next} noValidate className="space-y-6">
      {lockClient && <p className="rounded-md bg-page px-3 py-2 text-ink-2">These details are on file. To change them, edit the client on their profile.</p>}
      <ClientFields value={client} onChange={onClient} errors={clientErrors} disabled={lockClient} />
      {questions.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold">About your consultation</h2>
          <QuestionFields questions={questions} values={answers} onChange={onAnswers} errors={answerErrors} />
        </div>
      )}
      {(Object.keys(clientErrors).length > 0 || Object.keys(answerErrors).length > 0) && <p className="text-sm font-medium text-primary">Please fix the highlighted fields.</p>}
      {onBack ? (
        <div className="flex gap-3">
          <button type="button" className="btn h-11" onClick={onBack}>Back</button>
          <button className="btn btn-primary h-11 flex-1">Next</button>
        </div>
      ) : (
        <button className="btn btn-primary h-11 w-full">Next</button>
      )}
    </form>
  );
}
