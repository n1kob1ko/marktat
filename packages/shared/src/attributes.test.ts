import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_FIELDS, validateListingAttributes } from './attributes.js';

describe('category attributes', () => {
  it('defines separate fields by vertical', () => {
    expect(ATTRIBUTE_FIELDS.VEHICLES.map((f) => f.key)).toContain('mileageKm');
    expect(ATTRIBUTE_FIELDS.REAL_ESTATE.map((f) => f.key)).toContain('livingAreaSqm');
    expect(ATTRIBUTE_FIELDS.JOBS.map((f) => f.key)).toContain('weeklyHours');
  });
  it('accepts valid optional numeric attributes', () => {
    expect(validateListingAttributes('VEHICLES', { mileageKm: 85000, firstRegistrationYear: 2019 })).toEqual([]);
    expect(validateListingAttributes('MARKETPLACE', {})).toEqual([]);
  });
  it('rejects out-of-range and foreign attributes', () => {
    expect(validateListingAttributes('VEHICLES', { mileageKm: -1 })).toHaveLength(1);
    expect(validateListingAttributes('JOBS', { livingAreaSqm: 90 })).toHaveLength(1);
    expect(validateListingAttributes('REAL_ESTATE', { rooms: Number.POSITIVE_INFINITY })).toHaveLength(1);
  });
});
