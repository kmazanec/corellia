/**
 * The human→factory front door in the console: commission a job onto the
 * queue for a repo some worker serves (ADR-051). On success the operator is
 * taken to the new job, which shows queued until a worker picks it up.
 */

import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogTrigger,
  Form,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  NumberField,
  Popover,
  Radio,
  RadioGroup,
  Select,
  SelectValue,
  TextArea,
  TextField,
} from 'react-aria-components';

import { useCommission, type CommissionRequest } from '../api/commands';
import type { Fleet } from '../factory';
import { Plate } from './Frame';

type Intent = NonNullable<CommissionRequest['intent']>;
type Simulate = NonNullable<CommissionRequest['simulate']>;

export function CommissionDialog({ fleet }: { fleet: Fleet | undefined }) {
  return (
    <DialogTrigger>
      <Button className="btn primary">Commission a job</Button>
      <ModalOverlay isDismissable className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(8,6,3,.72)] p-4 sm:pt-[6vh]">
        <Modal className="w-full max-w-[640px] outline-none">
          <Dialog className="outline-none" aria-label="Commission a job">
            {({ close }) => <CommissionForm fleet={fleet} onDone={close} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function CommissionForm({ fleet, onDone }: { fleet: Fleet | undefined; onDone: () => void }) {
  const repos = fleet?.repos ?? [];
  const navigate = useNavigate();
  const commission = useCommission();
  const [title, setTitle] = useState('');
  const [repo, setRepo] = useState<string | null>(repos.length === 1 ? repos[0]!.repo : null);
  const [description, setDescription] = useState('');
  const [constraints, setConstraints] = useState('');
  const [scope, setScope] = useState('');
  const [ceiling, setCeiling] = useState(Number.NaN);
  const [intent, setIntent] = useState<Intent>('production');
  const [simulate, setSimulate] = useState<Simulate | 'none'>('none');

  const submit = () => {
    if (!repo) return;
    const req: CommissionRequest = {
      title,
      repo,
      description,
      constraints: lines(constraints),
      scope: scope.split(/[\s,]+/).filter(Boolean),
      intent,
      ...(Number.isFinite(ceiling) ? { spendCeilingUsd: ceiling } : {}),
      ...(simulate !== 'none' ? { simulate } : {}),
    };
    commission.mutate(req, {
      onSuccess: (job) => {
        onDone();
        void navigate({ to: '/jobs/$jobId', params: { jobId: job.jobId } });
      },
    });
  };

  return (
    <Plate title="Commission a job" number="Front door">
      <Form
        className="mt-3 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField value={title} onChange={setTitle} isRequired minLength={3} autoFocus>
          <Label className="field-label">Title</Label>
          <Input className="field-input" placeholder="Add rate limiting to the webhook ingress" />
        </TextField>

        <Field hint={repos.length === 0 ? 'No worker has registered. Start one with npm run worker.' : 'Only repos a registered worker serves.'}>
          <Select selectedKey={repo} onSelectionChange={(k) => setRepo(k === null ? null : String(k))} isRequired isDisabled={repos.length === 0} aria-label="Repo">
            <Label className="field-label">Repo</Label>
            <Button className="field-input field-select">
              <SelectValue className="truncate data-[placeholder]:text-ink-soft">{({ isPlaceholder, defaultChildren }) => (isPlaceholder ? 'Choose a repo' : defaultChildren)}</SelectValue>
              <span aria-hidden className="text-ink-soft">▾</span>
            </Button>
            <Popover>
              <ListBox className="listbox" items={repos}>
                {(r) => (
                  <ListBoxItem id={r.repo} textValue={r.repo} className="listbox-item">
                    {r.repo}
                    <span className="ml-2 text-[10.5px] text-ink-soft">
                      {r.alive}/{r.workers} alive · {r.busy} busy
                    </span>
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>
        </Field>

        <TextField value={description} onChange={setDescription} isRequired>
          <Label className="field-label">What should exist when it is done</Label>
          <TextArea className="field-input" rows={4} placeholder="Behaviour, not implementation." />
        </TextField>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field hint="One per line: open a PR, must not touch X, test-first…">
            <TextField value={constraints} onChange={setConstraints}>
              <Label className="field-label">Constraints</Label>
              <TextArea className="field-input !text-[13.5px]" rows={3} />
            </TextField>
          </Field>
          <Field hint="Path prefixes the job owns. Empty means the whole repo.">
            <TextField value={scope} onChange={setScope}>
              <Label className="field-label">Scope</Label>
              <Input className="field-input" placeholder="src/daemon src/contract" />
            </TextField>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field hint="The whole tree's dollar bound. Blank uses the engine default.">
            <NumberField value={ceiling} onChange={setCeiling} minValue={0.5} maxValue={1000} step={0.5} formatOptions={{ style: 'currency', currency: 'USD' }}>
              <Label className="field-label">Spend ceiling</Label>
              <Input className="field-input" placeholder="$15.00" />
            </NumberField>
          </Field>
          <RadioGroup value={intent} onChange={(v) => setIntent(v as Intent)} className="flex flex-col">
            <Label className="field-label">Intent</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
              <Radio value="production" className="radio">production</Radio>
              <Radio value="spike" className="radio">spike</Radio>
              <Radio value="characterization" className="radio">characterization</Radio>
            </div>
          </RadioGroup>
        </div>

        <RadioGroup value={simulate} onChange={(v) => setSimulate(v as Simulate | 'none')} className="border-t border-line-soft pt-3">
          <Label className="field-label">Simulated outcome · workers on the simulated engine only</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            <Radio value="none" className="radio">as the engine decides</Radio>
            <Radio value="done" className="radio">done</Radio>
            <Radio value="parked" className="radio">parks for an answer</Radio>
            <Radio value="failed" className="radio">fails</Radio>
          </div>
        </RadioGroup>

        {commission.error ? <p className="font-mono text-[12px] text-oxblood" role="alert">{commission.error.message}</p> : null}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" className="btn primary" isDisabled={commission.isPending || !repo}>
            {commission.isPending ? 'Queuing…' : 'Queue it'}
          </Button>
          <Button slot="close" className="btn !border-line-soft !bg-transparent !text-ink-soft">
            Cancel
          </Button>
        </div>
      </Form>
    </Plate>
  );
}

function Field({ hint, children }: { hint?: string; children: ReactNode }) {
  return (
    <div>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
