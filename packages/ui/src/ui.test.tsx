import { render, screen } from '@testing-library/react';
import { Button, Field, Input } from './index';

describe('Field', () => {
  it('verknüpft Label, Hinweis und Fehler barrierefrei mit dem Eingabefeld', () => {
    render(
      <Field label="E-Mail" hint="Wir geben sie nicht weiter." error="Ungültige E-Mail" required>
        <Input name="email" />
      </Field>,
    );
    const input = screen.getByLabelText(/E-Mail/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('required')).toBe(true);
    const describedBy = input.getAttribute('aria-describedby')!.split(' ');
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[1]!)?.textContent).toBe('Ungültige E-Mail');
  });
});

describe('Button', () => {
  it('ist im Ladezustand deaktiviert und als beschäftigt markiert', () => {
    render(<Button loading>Speichern</Button>);
    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('ist standardmäßig kein Submit-Button', () => {
    render(<Button>Abbrechen</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});
