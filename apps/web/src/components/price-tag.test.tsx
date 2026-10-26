import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceTag, priceLabel } from './price-tag';

describe('priceLabel', () => {
  it('formatiert Preise im österreichischen Format', () => {
    expect(priceLabel('FIXED', 129_950)).toBe('€ 1.299,50');
  });
  it('beschriftet Preisarten ohne Betrag', () => {
    expect(priceLabel('FREE', null)).toBe('Zu verschenken');
    expect(priceLabel('ON_REQUEST', null)).toBe('Preis auf Anfrage');
    expect(priceLabel(null, null)).toBe('Kein Preis angegeben');
  });
});

describe('PriceTag', () => {
  it('kennzeichnet Verhandlungsbasis', () => {
    render(<PriceTag priceType="NEGOTIABLE" priceCents={5000} />);
    expect(screen.getByText('VB')).toBeTruthy();
  });
});
