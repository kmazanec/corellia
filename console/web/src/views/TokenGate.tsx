import { useState } from 'react';
import { Button, Form, Input, Label, TextField } from 'react-aria-components';

import { setToken } from '../api/token';
import { Plate } from '../components/Frame';

/** Asks for the operator token (ADR-026's FRONT_DOOR_TOKEN) before anything else. */
export function TokenGate() {
  const [value, setValue] = useState('');
  return (
    <div className="mx-auto mt-[8vh] max-w-[460px]">
      <Plate title="Present the operator token" number="Admission">
        <Form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) setToken(value.trim());
          }}
        >
          <p className="font-prose text-[14px] leading-relaxed text-ink-soft">
            The control plane admits one operator, by the token the daemon was started with
            (<code className="font-mono text-[12px] text-ink">FRONT_DOOR_TOKEN</code>). It is kept in this browser only.
          </p>
          <TextField value={value} onChange={setValue} type="password" autoFocus isRequired>
            <Label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">Token</Label>
            <Input className="field-input" autoComplete="current-password" />
          </TextField>
          <Button type="submit" className="btn primary self-start">
            Enter
          </Button>
        </Form>
      </Plate>
    </div>
  );
}
