import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalFact } from '@/components/legal-fact';
import { missingOperatorFields, OPERATOR, type Operator } from './operator';

const complete: Operator = {
  ...OPERATOR,
  name: 'Beispiel GmbH',
  street: 'Beispielgasse 1',
  postalCode: '1010',
  city: 'Wien',
  email: 'office@example.at',
  dsaContactEmail: 'dsa@example.at',
};

describe('Betreiberangaben', () => {
  it('nennt fehlende Pflichtangaben', () => {
    expect(missingOperatorFields({ ...complete, email: null, city: '  ' })).toEqual(['city', 'email']);
    expect(missingOperatorFields(complete)).toEqual([]);
  });

  it('zeigt statt einer fehlenden Angabe einen sichtbaren Hinweis', () => {
    render(
      <ul>
        <LegalFact label="Name" value={null} />
        <LegalFact label="E-Mail" value="office@example.at" />
      </ul>,
    );
    expect(screen.getByText('Angabe fehlt noch')).toBeTruthy();
    expect(screen.getByText('office@example.at')).toBeTruthy();
  });
});
