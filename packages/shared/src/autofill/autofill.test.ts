import { describe, expect, it } from 'vitest';
import { categoryAttributeSchema } from '../attributes/definitions.js';
import { coerceAttributeSuggestions } from './index.js';

describe('coerceAttributeSuggestions', () => {
  it('übernimmt die Angaben einer Grafikkarten-Verpackung', () => {
    const schema = categoryAttributeSchema('marktplatz/computer-software/pc-komponenten/grafikkarten');
    const attributes = coerceAttributeSuggestions(schema, [
      { key: 'chipMaker', value: 'NVIDIA' },
      { key: 'chipModel', value: 'GeForce RTX 4070 Super' },
      { key: 'vramGb', value: '12 GB' },
      { key: 'brand', value: 'ASUS' },
    ]);
    expect(attributes).toEqual({ chipMaker: 'nvidia', chipModel: 'GeForce RTX 4070 Super', vramGb: '12', brand: 'ASUS' });
  });

  it('verwirft unbekannte Felder und ungültige Werte, behält den Rest', () => {
    const schema = categoryAttributeSchema('auto-motor/gebrauchtwagen');
    const attributes = coerceAttributeSuggestions(schema, [
      { key: 'brand', value: 'VW' },
      { key: 'mileageKm', value: '85.000 km' },
      { key: 'firstRegistrationYear', value: '1850' },
      { key: 'fuelType', value: 'Wasserstoff-Raketenantrieb' },
      { key: 'vramGb', value: '12' },
    ]);
    expect(attributes).toEqual({ brand: 'vw', mileageKm: 85000 });
  });

  it('setzt feste Werte der Kategorie und liest Mehrfachauswahl und Kommazahlen', () => {
    const schema = categoryAttributeSchema('immobilien/wohnungen/mietwohnungen');
    const attributes = coerceAttributeSuggestions(schema, [
      { key: 'offerType', value: 'BUY' },
      { key: 'rooms', value: '2,5' },
      { key: 'features', value: 'Balkon, Lift, Raumschiff' },
    ]);
    expect(attributes.offerType).toBe('RENT');
    expect(attributes.rooms).toBe(2.5);
    expect(attributes.features).toEqual(['balcony', 'elevator']);
  });

  it('liefert ohne Zusatzfelder nichts', () => {
    expect(coerceAttributeSuggestions(categoryAttributeSchema('marktplatz/sport-sportgeraete'), [{ key: 'brand', value: 'X' }])).toEqual({});
  });
});
