import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export class CsvStreamError extends Error {}

/**
 * CSV nach RFC 4180 als Datenstrom (Produktfeeds mit vielen tausend Zeilen): liefert die Kopfzeile und danach jede
 * Zeile als Objekt Spalte → Wert. Felder mit Anführungszeichen, verdoppelten "" und Zeilenumbrüchen werden
 * unterstützt; ein BOM am Anfang wird entfernt. Werte werden nur als Text gelesen – nie ausgewertet.
 */
export async function* readCsvRecords(stream: Readable, options: { delimiter?: string; maxFieldLength?: number } = {}): AsyncGenerator<Record<string, string>> {
  const maxField = options.maxFieldLength ?? 20_000;
  const decoder = new StringDecoder('utf8');
  let delimiter = options.delimiter;
  let headers: string[] | null = null;
  let record: string[] = [];
  let field = '';
  let quoted = false;
  /** Letztes Zeichen war ein schließendes Anführungszeichen innerhalb eines Feldes (für "" über Chunk-Grenzen) */
  let pendingQuote = false;
  let first = true;
  let pendingCr = false;

  const finishRecord = (): Record<string, string> | null => {
    record.push(field);
    field = '';
    const values = record;
    record = [];
    if (!values.some((cell) => cell.trim() !== '')) return null;
    if (!headers) {
      headers = values.map((h) => h.trim().toLowerCase());
      if (headers.some((h) => h === '')) throw new CsvStreamError('Jede Spalte des Feeds braucht eine Überschrift.');
      return null;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]!] = (values[i] ?? '').trim();
    return row;
  };

  for await (const chunk of stream) {
    let text = decoder.write(chunk as Buffer);
    if (first) {
      text = text.replace(/^﻿/, '');
      if (!delimiter) {
        const line = text.slice(0, Math.max(0, text.search(/\r?\n/)) || text.length);
        const counts = [',', ';', '\t', '|'].map((d) => [d, line.split(d).length - 1] as const);
        delimiter = counts.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
      }
      first = false;
    }
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      if (pendingCr) {
        pendingCr = false;
        if (char === '\n') continue;
      }
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false;
          if (char === '"') {
            field += '"';
            continue;
          }
          quoted = false;
          // weiter mit der Auswertung außerhalb der Anführungszeichen
        } else if (char === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += char;
          if (field.length > maxField) throw new CsvStreamError('Ein Feld des Feeds ist ungewöhnlich lang – der Feed ist vermutlich beschädigt.');
          continue;
        }
      }
      if (char === '"' && field === '') quoted = true;
      else if (char === delimiter) {
        record.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        const row = finishRecord();
        if (row) rows.push(row);
        if (char === '\r') pendingCr = true;
      } else {
        field += char;
        if (field.length > maxField) throw new CsvStreamError('Ein Feld des Feeds ist ungewöhnlich lang – der Feed ist vermutlich beschädigt.');
      }
    }
    for (const row of rows) yield row;
  }
  const rest = decoder.end();
  if (rest) field += rest;
  if (quoted && !pendingQuote) throw new CsvStreamError('Der Feed endet mitten in einem Feld mit Anführungszeichen.');
  if (field !== '' || record.length) {
    const row = finishRecord();
    if (row) yield row;
  }
  if (!headers) throw new CsvStreamError('Der Feed ist leer.');
}
