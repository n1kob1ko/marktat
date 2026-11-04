import { describe, expect, it } from 'vitest';
import { matchDealCategory } from './awin-mapping.js';

const byTitle = (title: string, categoryText = '') => matchDealCategory({ title, categoryText });

describe('matchDealCategory', () => {
  it('ordnet eindeutige Produktarten nach dem Titel ein, auch gegen die Feed-Kategorie', () => {
    expect(byTitle('Philips EP5541/50 Latte Go Kaffeevollautomat (Matt)', 'Kaffee')).toBe('haushalt-kueche');
    expect(byTitle('La Sommelière ELYSee Weinkühlschrank (242 l)', 'Wein')).toBe('haushalt-kueche');
    expect(byTitle('Liebherr MRFvc 4011 Getränkekühlschrank')).toBe('haushalt-kueche');
    expect(byTitle('Bosch WRB247C40 Wärmepumpentrockner (9,0 kg, EEK: A)', 'Elektronik')).toBe('haushalt-kueche');
    expect(byTitle('Russell Hobbs 22470-56 Reisedampfbürste')).not.toBe('reisen-freizeit');
    expect(byTitle('Profi Care PC-DB 3125 Reise Dampfbügelstation')).toBe('haushalt-kueche');
    expect(byTitle('Wanda - Bussi [CD]', 'Elektronik')).toBe('filme-musik-buecher');
    expect(byTitle('Fight or Flight [Blu-ray]')).toBe('filme-musik-buecher');
    expect(byTitle('Kindergarten Cop (Mediabook)')).toBe('filme-musik-buecher');
    expect(byTitle('Apple Watch Series 12 GPS + Cellular 46mm')).toBe('smartphones-tablets');
    expect(byTitle('SKROSS 1.500266-E Reiseadapter Europa')).toBe('elektronik-computer');
    expect(byTitle('Vivanco 08608 Reisestecker USA')).toBe('elektronik-computer');
    expect(byTitle('Therabody Theragun Prime Massagepistole')).toBe('drogerie');
    expect(byTitle('Playmobil 71205 City Life: Autowerkstatt')).toBe('baby-familie');
    expect(byTitle('Lego Sonic 77118')).toBe('baby-familie');
  });

  it('verwechselt Typenbezeichnungen und Wortteile nicht mehr', () => {
    expect(byTitle('Koenic KFZ 631 C NF W Standgefrierschrank')).toBe('haushalt-kueche');
    expect(byTitle('Cellular Line KFZ-Halterung')).toBe('autozubehoer');
    expect(byTitle('Aceto Balsamico di Modena')).not.toBe('mode-schuhe');
    expect(byTitle('Samsung MODEL X Monitor')).toBe('elektronik-computer');
    expect(byTitle('Jacke', 'Damenmode')).toBe('mode-schuhe');
    expect(byTitle('Starbucks Toffee Nut Kaffeekapsel, 10 Stück')).toBe('lebensmittel');
  });

  it('nutzt sonst die Feed-Kategorie vor dem Titel und liefert null ohne Treffer', () => {
    expect(byTitle('Kinderwagen Sport', 'Baby > Kinderwagen')).toBe('baby-familie');
    expect(byTitle('Hildegard Knef - Grosse Erfolge', 'Musik > Schlager')).toBe('filme-musik-buecher');
    expect(byTitle('Irgendwas 3000')).toBeNull();
  });
});
