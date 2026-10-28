import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CsvParseError,
  DEAL_IMPORT_DAILY_LIMIT,
  DEAL_IMPORT_MAX_BYTES,
  DEAL_IMPORT_PREVIEW_HOURS,
  dealCompleteSchema,
  dealDiscountPercent,
  dealImportRowToFields,
  missingRequiredFields,
  parseCsv,
  suggestDealImportMapping,
  toViennaDay,
  type AdminDealImportSummary,
  type DealFields,
  type DealImportCommitInput,
  type DealImportCounts,
  type DealImportMapping,
  type DealImportRowResult,
  type DealImportSummary,
  type DealImportView,
  type ParsedTable,
} from '@marktat/shared';
import type { Deal, DealImport, Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { MODERATION_REVIEW_REASON } from '../moderation/moderation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentDealFields, DealFieldError, DISCOUNT_REVIEW_REASON, needsDiscountReview, prepareDeal, replaceDealStores, statusAfterChange } from './deal-fields.js';
import { DealSearchService } from './deal-search.service.js';
import { DealsService, MAX_DEALS_PER_MERCHANT } from './deals.service.js';

type ExistingDeal = Deal & { category: { slug: string }; stores: { storeId: string }[] };

/** Geplanter Schritt je Zeile (Vorschau) – beim Übernehmen wird jede Zeile noch einmal frisch geprüft */
export interface RowPlan extends DealImportRowResult {
  fields?: DealFields;
  existing?: ExistingDeal;
}

export interface ImportPlan {
  rows: RowPlan[];
  counts: DealImportCounts;
  hasReferencePrices: boolean;
}

export interface ApplyOptions {
  source: 'CSV' | 'FEED';
  importId: string;
  feedId?: string;
  publish: boolean;
  confirmReferencePrices: boolean;
  actorId: string;
  ip?: string;
}

/** Felder, deren Änderung im Ergebnis genannt wird (Nachvollziehbarkeit) */
const FIELD_LABELS: Partial<Record<keyof DealFields, string>> = {
  title: 'Titel',
  description: 'Beschreibung',
  categorySlug: 'Kategorie',
  channel: 'Kanal',
  url: 'Link',
  isAffiliateLink: 'Werbelink',
  priceCents: 'Preis',
  unitPriceText: 'Grundpreis',
  shippingNote: 'Versand',
  referencePriceCents: 'Vergleichspreis',
  referencePriceType: 'Art des Vergleichspreises',
  referencePriceSource: 'Quelle des Vergleichspreises',
  referencePriceEvidenceUrl: 'Beleg-Link',
  availability: 'Verfügbarkeit',
  startsOn: 'Beginn',
  endsOn: 'Ende',
  storeIds: 'Filialen',
  brand: 'Marke',
  gtin: 'GTIN',
};

const emptyCounts = (): DealImportCounts => ({ total: 0, create: 0, update: 0, unchanged: 0, skip: 0, ended: 0, error: 0 });

function count(rows: DealImportRowResult[]): DealImportCounts {
  const counts = emptyCounts();
  counts.total = rows.filter((r) => r.action !== 'END').length;
  for (const row of rows) {
    const key = ({ CREATE: 'create', UPDATE: 'update', UNCHANGED: 'unchanged', SKIP: 'skip', END: 'ended', ERROR: 'error' } as const)[row.action];
    counts[key]++;
  }
  return counts;
}

const normalized = (value: unknown) => (Array.isArray(value) ? [...value].sort().join('|') : value === undefined || value === '' ? null : value);

export function changedFields(before: DealFields, after: DealFields): string[] {
  return (Object.keys(FIELD_LABELS) as (keyof DealFields)[]).filter((key) => normalized(before[key]) !== normalized(after[key])).map((key) => FIELD_LABELS[key]!);
}

export function hashFields(fields: DealFields): string {
  const ordered = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalized(v)]));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/** UTF-8, sonst Windows-1252 (Excel speichert CSV in Österreich oft so) */
export function decodeText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Bitte wähle eine CSV-Datei aus.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}

/**
 * CSV-Import der Händler: Datei hochladen → Spalten zuordnen → Vorschau mit Fehlern je Zeile → übernehmen.
 * Angebote werden über die eigene Artikelnummer erkannt: Ein erneuter Import aktualisiert, statt doppelt anzulegen.
 * Dieselbe Verarbeitung (analyze/apply) nutzen die freigegebenen Produktfeeds.
 */
@Injectable()
export class DealImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: DealSearchService,
    private readonly deals: DealsService,
  ) {}

  // --- CSV-Import im Händlerbereich ---------------------------------------------------

  async upload(user: AuthUser, body: unknown, fileName: string | undefined, ip?: string): Promise<DealImportView> {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Deals können nur gewerbliche Konten importieren.');
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await this.prisma.dealImport.count({ where: { merchantId: user.id, source: 'CSV', createdAt: { gte: since } } });
    if (recent >= DEAL_IMPORT_DAILY_LIMIT) throw new ConflictException(`Höchstens ${DEAL_IMPORT_DAILY_LIMIT} Importe in 24 Stunden. Bitte versuche es später erneut.`);
    if (Buffer.isBuffer(body) && body.length > DEAL_IMPORT_MAX_BYTES) throw new BadRequestException('Die Datei darf höchstens 2 MB groß sein.');
    const text = decodeText(body);
    const table = this.parse(text);
    const mapping = suggestDealImportMapping(table.headers);
    const plan = await this.analyze(user.id, table, mapping);
    const created = await this.prisma.dealImport.create({
      data: {
        merchantId: user.id,
        source: 'CSV',
        format: 'CSV',
        fileName: fileName?.replace(/[^\w.\- äöüÄÖÜß()]/g, '').slice(0, 200) || null,
        rawText: text,
        headers: table.headers,
        mapping,
        rows: this.storedRows(plan.rows),
        counts: plan.counts as unknown as Prisma.InputJsonValue,
        hasReferencePrices: plan.hasReferencePrices,
        expiresAt: new Date(Date.now() + DEAL_IMPORT_PREVIEW_HOURS * 3600_000),
      },
    });
    this.audit.log({ action: 'deal.import_uploaded', actorId: user.id, entityType: 'deal_import', entityId: created.id, ip, metadata: { rows: plan.counts.total } });
    return this.toView(created);
  }

  async setMapping(user: AuthUser, id: string, mapping: DealImportMapping): Promise<DealImportView> {
    const current = await this.requirePreview(user, id);
    const headers = current.headers as string[];
    for (const header of Object.values(mapping)) {
      if (header && !headers.includes(header)) throw new BadRequestException(`Die Spalte „${header.slice(0, 60)}“ gibt es in der Datei nicht.`);
    }
    const plan = await this.analyze(user.id, this.parse(current.rawText!), mapping);
    const updated = await this.prisma.dealImport.update({
      where: { id },
      data: { mapping, rows: this.storedRows(plan.rows), counts: plan.counts as unknown as Prisma.InputJsonValue, hasReferencePrices: plan.hasReferencePrices },
    });
    return this.toView(updated);
  }

  async commit(user: AuthUser, id: string, input: DealImportCommitInput, ip?: string): Promise<DealImportView> {
    const current = await this.requirePreview(user, id);
    const mapping = current.mapping as DealImportMapping;
    const missing = missingRequiredFields(mapping);
    if (missing.length) throw new BadRequestException('Bitte ordne zuerst alle Pflichtspalten zu.');
    // Gegen Doppelklick: nur eine Übernahme je Vorschau
    const claimed = await this.prisma.dealImport.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'COMMITTED', committedAt: new Date(), publish: input.publish } });
    if (!claimed.count) throw new ConflictException('Dieser Import wurde bereits übernommen oder verworfen.');
    try {
      const plan = await this.analyze(user.id, this.parse(current.rawText!), mapping);
      const result = await this.apply(user.id, plan, {
        source: 'CSV',
        importId: id,
        publish: input.publish,
        confirmReferencePrices: input.confirmReferencePrices === true,
        actorId: user.id,
        ip,
      });
      const updated = await this.prisma.dealImport.update({
        where: { id },
        data: { rawText: null, expiresAt: null, rows: this.storedRows(result.rows), counts: result.counts as unknown as Prisma.InputJsonValue },
      });
      return this.toView(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler';
      // Berechtigungsfehler sind keine Systemfehler: Vorschau bleibt erhalten, damit der Händler es erneut versuchen kann
      if (error instanceof ForbiddenException || error instanceof ConflictException || error instanceof BadRequestException) {
        await this.prisma.dealImport.update({ where: { id }, data: { status: 'PREVIEW', committedAt: null, publish: null } });
      } else {
        await this.prisma.dealImport.update({ where: { id }, data: { status: 'FAILED', error: message, rawText: null } });
      }
      throw error;
    }
  }

  async cancel(user: AuthUser, id: string) {
    await this.requirePreview(user, id);
    await this.prisma.dealImport.update({ where: { id }, data: { status: 'CANCELLED', rawText: null, expiresAt: null } });
  }

  async list(user: AuthUser): Promise<DealImportSummary[]> {
    const rows = await this.prisma.dealImport.findMany({ where: { merchantId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((row) => this.toSummary(row));
  }

  async get(user: AuthUser, id: string): Promise<DealImportView> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Import gibt es nicht.');
    const row = await this.prisma.dealImport.findUnique({ where: { id } });
    if (!row || row.merchantId !== user.id) throw new NotFoundException('Diesen Import gibt es nicht.');
    return this.toView(row);
  }

  /** Moderation: fehlgeschlagene Importe und übernommene Importe mit fehlerhaften Zeilen (letzte 30 Tage) */
  async adminFailures(): Promise<AdminDealImportSummary[]> {
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const rows = await this.prisma.dealImport.findMany({
      where: { createdAt: { gte: since }, OR: [{ status: 'FAILED' }, { status: 'COMMITTED', counts: { path: ['error'], gt: 0 } }] },
      include: { merchant: { select: { id: true, displayName: true, companyName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => ({ ...this.toSummary(row), merchant: { id: row.merchant.id, name: row.merchant.companyName ?? row.merchant.displayName } }));
  }

  /** Moderation: Ergebnis eines Imports je Zeile (ohne Rohdaten) */
  async adminGet(id: string): Promise<DealImportView & { merchant: { id: string; name: string } }> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Import gibt es nicht.');
    const row = await this.prisma.dealImport.findUnique({ where: { id }, include: { merchant: { select: { id: true, displayName: true, companyName: true } } } });
    if (!row) throw new NotFoundException('Diesen Import gibt es nicht.');
    return { ...this.toView(row), merchant: { id: row.merchant.id, name: row.merchant.companyName ?? row.merchant.displayName } };
  }

  /** Abgelaufene Vorschauen: Rohdaten löschen (Datenminimierung) */
  async expirePreviews(now = new Date()) {
    const result = await this.prisma.dealImport.updateMany({ where: { status: 'PREVIEW', expiresAt: { lte: now } }, data: { status: 'EXPIRED', rawText: null } });
    return result.count;
  }

  // --- Gemeinsame Verarbeitung (CSV und Feed) ------------------------------------------

  parse(text: string): ParsedTable {
    try {
      return parseCsv(text);
    } catch (error) {
      if (error instanceof CsvParseError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Jede Zeile umwandeln, prüfen und mit vorhandenen Deals (gleiche Artikelnummer) abgleichen – ohne zu speichern */
  async analyze(merchantId: string, table: ParsedTable, mapping: DealImportMapping): Promise<ImportPlan> {
    const [categories, stores] = await Promise.all([
      this.prisma.dealCategory.findMany({ where: { isActive: true }, select: { slug: true, name: true } }),
      this.prisma.dealerStore.findMany({ where: { merchantId, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const context = { categories, stores, today: toViennaDay(new Date()) };
    const missing = missingRequiredFields(mapping);
    const converted = table.rows.map((row) => dealImportRowToFields(table.headers, row, mapping, context));
    // Ohne Beginn in der Datei gilt „heute“ – bei bestehenden Angeboten bleibt dagegen der bisherige Beginn
    const startIndex = mapping.startsOn ? table.headers.indexOf(mapping.startsOn) : -1;
    const startGiven = table.rows.map((row) => startIndex >= 0 && Boolean(row[startIndex]?.trim()));
    const externalIds = [...new Set(converted.map((c) => c.fields.externalId).filter((v): v is string => Boolean(v)))];
    const existingRows = externalIds.length
      ? await this.prisma.deal.findMany({
          where: { merchantId, externalId: { in: externalIds }, status: { not: 'DELETED' } },
          include: { category: { select: { slug: true } }, stores: { select: { storeId: true } } },
        })
      : [];
    const existing = new Map(existingRows.map((d) => [d.externalId!, d]));
    const titles = await this.prisma.deal.findMany({
      where: { merchantId, status: { notIn: ['DELETED', 'EXPIRED'] } },
      select: { title: true, externalId: true },
      take: MAX_DEALS_PER_MERCHANT,
    });
    const byTitle = new Map(titles.map((t) => [t.title.toLowerCase(), t.externalId]));
    const seen = new Map<string, number>();
    let hasReferencePrices = false;

    const rows: RowPlan[] = converted.map(({ fields, issues }, index) => {
      const line = index + 2;
      const result: RowPlan = {
        line,
        externalId: typeof fields.externalId === 'string' ? fields.externalId.slice(0, 100) : null,
        title: typeof fields.title === 'string' ? fields.title.slice(0, 120) : null,
        action: 'ERROR',
        dealId: null,
        changes: [],
        messages: [],
        warnings: [],
      };
      if (missing.length) {
        result.messages.push('Nicht alle Pflichtspalten sind zugeordnet.');
        return result;
      }
      result.messages.push(...issues.map((i) => i.message));
      if (result.externalId) {
        const first = seen.get(result.externalId);
        if (first) result.messages.push(`Die Artikelnummer steht bereits in Zeile ${first}.`);
        else seen.set(result.externalId, line);
      }
      if (issues.length || result.messages.length) return result;
      const parsed = dealCompleteSchema.safeParse(fields);
      if (!parsed.success) {
        result.messages.push(...parsed.error.issues.map((i) => i.message));
        return result;
      }
      const data = parsed.data;
      if (data.referencePriceCents) hasReferencePrices = true;
      result.fields = data;
      const current = existing.get(data.externalId!);
      if (current && !startGiven[index]) {
        data.startsOn = toViennaDay(current.startsAt);
        const recheck = dealCompleteSchema.safeParse(data);
        if (!recheck.success) {
          result.messages.push(...recheck.error.issues.map((i) => i.message));
          return result;
        }
      }
      if (current) {
        result.dealId = current.id;
        result.existing = current;
        if (current.status === 'REJECTED' || (current.status === 'PENDING_REVIEW' && current.reviewReason === MODERATION_REVIEW_REASON)) {
          result.action = 'SKIP';
          result.messages.push('Vom Team abgelehnt bzw. ausgeblendet – bitte im Händlerbereich bearbeiten und erneut einreichen.');
          return result;
        }
        result.changes = changedFields(currentDealFields(current), data);
        result.action = result.changes.length ? 'UPDATE' : 'UNCHANGED';
      } else {
        result.action = 'CREATE';
        const twin = byTitle.get(data.title.toLowerCase());
        if (twin !== undefined) result.warnings.push(`Mögliches Doppel: Ein anderes Angebot${twin ? ` (Artikelnummer ${twin})` : ''} hat denselben Titel.`);
      }
      if (needsDiscountReview(dealDiscountPercent(data.priceCents, data.referencePriceCents, data.referencePriceType))) result.warnings.push('Sehr hoher Rabatt: Das Team prüft das Angebot vor dem Erscheinen.');
      return result;
    });
    return { rows, counts: count(rows), hasReferencePrices };
  }

  /**
   * Plan übernehmen: jede Zeile in einer eigenen Transaktion (ein Fehler betrifft nur diese Zeile).
   * Neue Deals: veröffentlicht oder Entwurf; bestehende behalten ihren Status (Prüfregeln wie beim Bearbeiten).
   * Jeder Import gilt als Bestätigung („Zuletzt geprüft“) der enthaltenen, laufenden Angebote.
   */
  async apply(merchantId: string, plan: ImportPlan, options: ApplyOptions): Promise<{ rows: DealImportRowResult[]; counts: DealImportCounts }> {
    const merchant = await this.prisma.user.findUniqueOrThrow({ where: { id: merchantId }, select: { id: true, accountType: true } });
    if (merchant.accountType !== 'BUSINESS') throw new ForbiddenException('Deals können nur gewerbliche Konten importieren.');
    const eligibility = await this.deals.eligibility(merchantId);
    if (eligibility.blocked) throw new ForbiddenException('Dein Konto ist für Deals gesperrt.');
    if (options.publish && !eligibility.eligible) throw new ForbiddenException('Zum Veröffentlichen fehlen noch Voraussetzungen (siehe „Meine Deals“). Du kannst als Entwurf importieren.');
    const creates = plan.rows.filter((r) => r.action === 'CREATE').length;
    const total = await this.prisma.deal.count({ where: { merchantId, status: { not: 'DELETED' } } });
    if (total + creates > MAX_DEALS_PER_MERCHANT) throw new ConflictException(`Mit diesem Import hättest du mehr als ${MAX_DEALS_PER_MERCHANT} Angebote. Bitte lösche zuerst alte Angebote.`);

    const now = new Date();
    const touched: string[] = [];
    const results: DealImportRowResult[] = [];
    for (const row of plan.rows) {
      const { fields, existing, ...result } = row;
      if (!fields || result.action === 'ERROR' || result.action === 'SKIP') {
        results.push(result);
        continue;
      }
      if (fields.referencePriceCents && !options.confirmReferencePrices) {
        results.push({ ...result, action: 'ERROR', messages: ['Vergleichspreise wurden nicht bestätigt – Zeile nicht übernommen.'] });
        continue;
      }
      try {
        const dealId = existing
          ? await this.applyUpdate(merchantId, existing, fields, result.action === 'UNCHANGED', options, now)
          : await this.applyCreate(merchantId, fields, options, now);
        if (dealId) touched.push(dealId);
        results.push({ ...result, dealId });
      } catch (error) {
        const messages = error instanceof DealFieldError ? error.issues.map((i) => i.message) : [error instanceof Error ? error.message : 'Unbekannter Fehler'];
        results.push({ ...result, action: 'ERROR', messages });
      }
    }
    const counts = count(results);
    this.audit.log({
      action: 'deal.import_committed',
      actorId: options.actorId,
      entityType: 'deal_import',
      entityId: options.importId,
      ip: options.ip,
      metadata: { source: options.source, feedId: options.feedId ?? null, publish: options.publish, ...counts },
    });
    this.search.index.syncMany(touched);
    return { rows: results, counts };
  }

  private async applyCreate(merchantId: string, fields: DealFields, options: ApplyOptions, now: Date): Promise<string> {
    const prepared = await prepareDeal(this.prisma, merchantId, fields);
    const endsAt = prepared.data.endsAt as Date;
    if (options.publish && endsAt <= now) throw new DealFieldError('Abgelaufen', [{ path: 'endsOn', message: 'Das Angebot ist bereits abgelaufen.' }]);
    const review = options.publish && needsDiscountReview(prepared.discountPercent);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          ...prepared.data,
          merchantId,
          source: options.source,
          feedId: options.feedId ?? null,
          lastImportId: options.importId,
          contentHash: hashFields(fields),
          status: options.publish ? (review ? 'PENDING_REVIEW' : 'ACTIVE') : 'DRAFT',
          reviewReason: review ? DISCOUNT_REVIEW_REASON : null,
          publishedAt: options.publish ? now : null,
          lastVerifiedAt: options.publish ? now : null,
          referenceConfirmedAt: prepared.data.referencePriceCents ? now : null,
        },
      });
      await replaceDealStores(tx, created.id, prepared.storeIds);
      if (options.publish) await this.deals.recordPrice(tx, created, options.source);
      return created.id;
    });
  }

  private async applyUpdate(merchantId: string, current: ExistingDeal, fields: DealFields, unchanged: boolean, options: ApplyOptions, now: Date): Promise<string> {
    const live = ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'].includes(current.status) && current.endsAt > now;
    if (unchanged) {
      // Unverändert: nur „Zuletzt geprüft“ (der Händler bestätigt mit dem Import, dass das Angebot noch gilt)
      if (live && current.publishedAt) await this.prisma.deal.update({ where: { id: current.id }, data: { lastVerifiedAt: now, lastImportId: options.importId } });
      return current.id;
    }
    const prepared = await prepareDeal(this.prisma, merchantId, fields);
    const endsAt = prepared.data.endsAt as Date;
    const referenceChanged = prepared.data.referencePriceCents !== current.referencePriceCents || prepared.data.referencePriceType !== current.referencePriceType;
    const priceChanged = referenceChanged || prepared.data.priceCents !== current.priceCents;
    let next = statusAfterChange(current, prepared.discountPercent, priceChanged);
    let publishedAt = current.publishedAt;
    // Entwürfe und abgelaufene Angebote werden nur mit „veröffentlichen“ (wieder) aktiv, und nur mit Ende in der Zukunft
    if (options.publish && endsAt > now && (current.status === 'DRAFT' || current.status === 'EXPIRED')) {
      const review = needsDiscountReview(prepared.discountPercent);
      next = { status: review ? 'PENDING_REVIEW' : 'ACTIVE', reviewReason: review ? DISCOUNT_REVIEW_REASON : null };
      publishedAt ??= now;
    }
    if (next.status !== 'DRAFT' && next.status !== 'EXPIRED' && endsAt <= now) next = { status: 'EXPIRED', reviewReason: next.reviewReason };
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.deal.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: {
          ...prepared.data,
          status: next.status,
          reviewReason: next.reviewReason,
          publishedAt,
          source: options.source,
          ...(options.feedId && { feedId: options.feedId }),
          lastImportId: options.importId,
          contentHash: hashFields(fields),
          ...(publishedAt && { lastVerifiedAt: now }),
          ...(referenceChanged && { referenceConfirmedAt: prepared.data.referencePriceCents ? now : null }),
        },
      });
      if (!changed.count) throw new ConflictException('Das Angebot wurde gerade anderweitig geändert. Bitte importiere erneut.');
      await replaceDealStores(tx, current.id, prepared.storeIds);
      if (publishedAt && priceChanged) {
        await this.deals.recordPrice(tx, { id: current.id, priceCents: prepared.data.priceCents as number, referencePriceCents: prepared.data.referencePriceCents ?? null }, options.source);
      }
    });
    return current.id;
  }

  // --- Ansichten -----------------------------------------------------------------------

  private storedRows(rows: RowPlan[]): Prisma.InputJsonValue {
    return rows.map(({ fields: _fields, existing: _existing, ...rest }) => rest) as unknown as Prisma.InputJsonValue;
  }

  private async requirePreview(user: AuthUser, id: string) {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Import gibt es nicht.');
    const row = await this.prisma.dealImport.findUnique({ where: { id } });
    if (!row || row.merchantId !== user.id) throw new NotFoundException('Diesen Import gibt es nicht.');
    if (row.status !== 'PREVIEW' || !row.rawText) throw new ConflictException('Dieser Import ist abgeschlossen. Lade die Datei für einen neuen Import erneut hoch.');
    if (row.expiresAt && row.expiresAt <= new Date()) throw new ConflictException('Die Vorschau ist abgelaufen. Bitte lade die Datei erneut hoch.');
    return row;
  }

  toSummary(row: DealImport): DealImportSummary {
    const counts = { ...emptyCounts(), ...(row.counts as Partial<DealImportCounts>) };
    return {
      id: row.id,
      // Importe gibt es nur für Händlerkonten (CSV, eigener Feed); Affiliate-Abrufe protokolliert affiliate_sync_runs
      source: row.source as Exclude<typeof row.source, 'AFFILIATE'>,
      feedId: row.feedId,
      fileName: row.fileName,
      status: row.status,
      counts,
      hasReferencePrices: row.hasReferencePrices,
      publish: row.publish,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  toView(row: DealImport): DealImportView {
    const mapping = row.mapping as DealImportMapping;
    return {
      ...this.toSummary(row),
      headers: row.headers as string[],
      mapping,
      missingFields: missingRequiredFields(mapping),
      rows: row.rows as unknown as DealImportRowResult[],
    };
  }
}
