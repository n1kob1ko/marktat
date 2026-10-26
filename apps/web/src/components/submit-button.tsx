'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@marktat/ui';

/** Submit-Button, der während der Server Action automatisch den Ladezustand zeigt. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, 'type' | 'loading'>) {
  const { pending, data } = useFormStatus();
  const isThisButton = !props.name || data?.get(props.name) === props.value;
  return (
    <Button type="submit" loading={pending && isThisButton} disabled={pending} {...props}>
      {children}
    </Button>
  );
}
