import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Field, inputClass, MutationStatus, Notice } from '../../components/ui';
import { useRpcMutation } from '../../lib/useRpcMutation';

export function AccountPanel() {
  const { context, refreshContext } = useAuth();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const m = useRpcMutation('set_manager_pin', 'set-manager-pin', {
    onSuccess: () => {
      setPin('');
      setConfirmPin('');
      void refreshContext();
    },
  });

  if (!context?.can_set_manager_pin) {
    return (
      <Notice tone="info">
        Manager PINs are only used by owners and location managers to approve actions on shared tablets.
      </Notice>
    );
  }
  const valid = /^[0-9]{6,12}$/.test(pin) && pin === confirmPin;
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_new_pin: pin });
      }}
    >
      <h2 className="text-lg font-semibold">Manager approval PIN</h2>
      <p className="text-sm text-slate-700">
        Used to approve discounts, post-start cancellations and similar actions at a shared terminal. Five wrong
        attempts lock the PIN for 15 minutes. The PIN is stored only as a one-way hash.
      </p>
      <p>{context.has_manager_pin ? <Badge tone="good">PIN set</Badge> : <Badge tone="warn">No PIN set</Badge>}</p>
      <Field label="New PIN (6–12 digits)" htmlFor="pin">
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className={inputClass}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field label="Repeat PIN" htmlFor="pin2">
        <input
          id="pin2"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className={inputClass}
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      {pin && confirmPin && pin !== confirmPin ? (
        <p className="text-sm font-semibold text-red-800">The PINs do not match.</p>
      ) : null}
      <Button type="submit" disabled={!m.canPost || !valid}>
        {context.has_manager_pin ? 'Change PIN' : 'Set PIN'}
      </Button>
      <MutationStatus
        state={m.state}
        successText="PIN saved."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}
