import { useState, type FormEvent } from 'react';
import { api, fmtDate } from '../api';
import { Empty, ErrorBox, Icon, Loading, useLoad, useToast, errMsg } from '../ui';
import type { SavedAnswer } from '../types';

export function AnswersPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const { data, setData, error, loading, reload } = useLoad(() => api<{ answers: SavedAnswer[] }>(`/answers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`), [q]);

  const save = async (id: string) => {
    try {
      const r = await api<{ answer: SavedAnswer }>(`/answers/${id}`, { method: 'PATCH', body: { answer: draft } });
      setData((d) => (d ? { answers: d.answers.map((a) => (a.id === id ? r.answer : a)) } : d));
      setEditing(null);
      toast('Answer updated.');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this saved answer? The extension will ask you again next time.')) return;
    try {
      await api(`/answers/${id}`, { method: 'DELETE' });
      setData((d) => (d ? { answers: d.answers.filter((a) => a.id !== id) } : d));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Saved answers</h1>
          <p>Answers you’ve given to screening questions. Equivalent questions on other sites reuse these automatically.</p>
        </div>
      </div>
      <AddAnswer onAdded={(a) => setData((d) => ({ answers: [a, ...(d?.answers ?? []).filter((x) => x.id !== a.id)] }))} />
      <div className="field">
        <label htmlFor="ans-search" className="sr-only">
          Search answers
        </label>
        <input id="ans-search" className="input" placeholder="Search questions or answers…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data!.answers.length ? (
        <div className="card">
          <Empty title={q ? 'No matching answers' : 'No saved answers yet'}>When the extension asks a question it doesn’t know, check “Remember this answer” and it will appear here.</Empty>
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
                <th>Last updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data!.answers.map((a) => (
                <tr key={a.id}>
                  <td style={{ maxWidth: 380 }}>
                    <div>{a.rawQuestion}</div>
                    {a.normalizedQuestion !== a.rawQuestion && <div className="small muted">Matches: {a.normalizedQuestion}</div>}
                    <div className="row small" style={{ marginTop: 4 }}>
                      {a.sensitive && <span className="badge badge-warn">Sensitive</span>}
                      <span className="badge">{a.source === 'learned' ? 'Learned while applying' : a.source === 'user' ? 'Saved by you' : a.source}</span>
                      {a.useCount > 0 && <span className="muted">used {a.useCount}×</span>}
                    </div>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    {editing === a.id ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Answer" />
                        <div className="row">
                          <button className="btn btn-sm btn-primary" onClick={() => void save(a.id)}>
                            Save
                          </button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</span>
                    )}
                  </td>
                  <td className="small muted">{fmtDate(a.updatedAt)}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        aria-label={`Edit answer to ${a.rawQuestion}`}
                        onClick={() => {
                          setEditing(a.id);
                          setDraft(a.answer);
                        }}
                      >
                        <Icon name="edit" />
                      </button>
                      <button className="btn btn-sm btn-ghost btn-danger" aria-label={`Delete answer to ${a.rawQuestion}`} onClick={() => void remove(a.id)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddAnswer({ onAdded }: { onAdded: (a: SavedAnswer) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ answer: SavedAnswer }>('/answers', { body: { question, answer } });
      onAdded(r.answer);
      setQuestion('');
      setAnswer('');
      setOpen(false);
    } catch (err) {
      setError(err);
    }
  };
  if (!open)
    return (
      <div>
        <button className="btn" onClick={() => setOpen(true)}>
          <Icon name="plus" /> Add an answer
        </button>
      </div>
    );
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="new-q">Question</label>
        <input id="new-q" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Are you legally authorized to work in the United States?" required />
      </div>
      <div className="field">
        <label htmlFor="new-a">Answer</label>
        <textarea id="new-a" className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-primary">Save answer</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
