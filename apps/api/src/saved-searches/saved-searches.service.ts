import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, BadRequestException } from '@nestjs/common';
import {
  formatPriceCents,
  hasActiveDealFilters,
  hasActiveFilters,
  hasActiveServiceFilters,
  MAX_SAVED_SEARCHES,
  parseDealSearchParams,
  parseServiceSearchParams,
  SAVED_SEARCH_DIGEST_HOURS,
  SAVED_SEARCH_PATHS,
  toDealSearchParams,
  toSearchParams,
  toServiceSearchParams,
  type CreateSavedSearchInput,
  type SavedSearch as SavedSearchDto,
  type SavedSearchKind,
  type UpdateSavedSearchInput,
} from '@marktat/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { loadEnv } from '../config/env.js';
import { Prisma, type SavedSearch } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { escapeHtml, MailService, mailLayout } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListingSearchService } from '../search/listing-search.service.js';
import { DealSearchService } from '../deals/deal-search.service.js';
import { ServiceSearchService } from '../services/service-search.service.js';

const ALERT_JOB = 'saved-search-alerts';
/** Neue Inserate brauchen kurz, bis sie im Suchindex stehen – so weit hinter „jetzt“ endet das Prüffenster */
const INDEX_LAG_MS = 2 * 60_000;
const ALERT_BATCH = 100;
const ALERT_LISTINGS = 5;
const HOUR_MS = 3_600_000;

/** Was eine Benachrichtigung enthält – unabhängig davon, ob es Inserate, Deals oder Anbieter sind */
interface AlertHits {
  total: number;
  lines: { title: string; price: string; url: string }[];
}

const KIND_WORDS: Record<SavedSearchKind, { one: string; many: string }> = {
  LISTINGS: { one: 'eine neue Anzeige', many: 'neue Anzeigen' },
  DEALS: { one: 'ein neuer Deal', many: 'neue Deals' },
  SERVICES: { one: 'ein neues Anbieterprofil', many: 'neue Anbieterprofile' },
};

/** Parameter, die nicht zur gespeicherten Suche gehören */
const VOLATILE_PARAMS = ['seite', 'pageSize'];

@Injectable()
export class SavedSearchesService implements OnModuleInit {
  private readonly logger = new Logger(SavedSearchesService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ListingSearchService,
    private readonly deals: DealSearchService,
    private readonly services: ServiceSearchService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register(ALERT_JOB, () => this.runAlerts().then(() => undefined));
    this.jobs.every(ALERT_JOB, this.env.SAVED_SEARCH_ALERT_MINUTES * 60_000);
  }

  async list(user: AuthUser): Promise<SavedSearchDto[]> {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_SAVED_SEARCHES,
    });
    return rows.map(toDto);
  }

  /** Prüft die Parameter mit derselben Logik wie die Suche und speichert sie in kanonischer Form. */
  async create(user: AuthUser, input: CreateSavedSearchInput): Promise<SavedSearchDto> {
    const params = await this.canonicalParams(input.kind, input.params);
    if ((await this.prisma.savedSearch.count({ where: { userId: user.id } })) >= MAX_SAVED_SEARCHES) {
      throw new BadRequestException(`Du kannst höchstens ${MAX_SAVED_SEARCHES} Suchen speichern. Lösche zuerst eine alte.`);
    }
    try {
      const row = await this.prisma.savedSearch.create({
        data: { userId: user.id, kind: input.kind, name: input.name, params, queryKey: queryKey(params), labels: input.labels, notify: input.notify },
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Diese Suche hast du bereits gespeichert.');
      }
      throw error;
    }
  }

  async update(user: AuthUser, id: string, input: UpdateSavedSearchInput): Promise<SavedSearchDto> {
    const existing = await this.requireOwn(user, id);
    const data: Prisma.SavedSearchUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.notify !== undefined) {
      data.notify = input.notify;
      // Beim Einschalten nur über Inserate ab jetzt informieren, nicht über alle seit dem Speichern
      if (input.notify && !existing.notify) data.lastCheckedAt = new Date();
    }
    return toDto(await this.prisma.savedSearch.update({ where: { id: existing.id }, data }));
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    if (!ENTITY_ID.test(id)) return;
    await this.prisma.savedSearch.deleteMany({ where: { id, userId: user.id } });
  }

  /**
   * Sucht für alle Suchen mit Benachrichtigung nach Treffern, die seit der letzten Prüfung veröffentlicht wurden,
   * und schickt je Suche höchstens eine E-Mail. Jeder Treffer wird je Suche nur einmal gemeldet (Zeitfenster).
   * Deals und Anbieterprofile werden nur einmal am Tag geprüft (SAVED_SEARCH_DIGEST_HOURS) – eine Sammelmail statt
   * vieler einzelner Benachrichtigungen.
   */
  async runAlerts(now = new Date()): Promise<{ checked: number; notified: number }> {
    const until = new Date(now.getTime() - INDEX_LAG_MS);
    const due = (kind: SavedSearchKind) => ({
      kind,
      lastCheckedAt: { lt: SAVED_SEARCH_DIGEST_HOURS[kind] ? new Date(Math.min(until.getTime(), now.getTime() - SAVED_SEARCH_DIGEST_HOURS[kind] * HOUR_MS)) : until },
    });
    let checked = 0;
    let notified = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.savedSearch.findMany({
        where: {
          notify: true,
          OR: [due('LISTINGS'), due('DEALS'), due('SERVICES')],
          user: { status: 'ACTIVE', deletedAt: null, notifySearchesByEmail: true },
        },
        include: { user: { select: { email: true, displayName: true } } },
        orderBy: { id: 'asc' },
        take: ALERT_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1]!.id;
      for (const saved of batch) {
        checked++;
        try {
          if (await this.alert(saved, until)) notified++;
        } catch (error) {
          // Eine kaputte Suche (z. B. gelöschte Kategorie) darf die anderen nicht aufhalten
          this.logger.warn(`Gespeicherte Suche ${saved.id} nicht geprüft: ${(error as Error).message}`);
          await this.prisma.savedSearch.update({ where: { id: saved.id }, data: { lastCheckedAt: until } });
        }
      }
    }
    return { checked, notified };
  }

  /** Neue Treffer im Zeitfenster [lastCheckedAt, until] – je nach Art der Suche */
  private async hits(saved: SavedSearch, until: Date): Promise<AlertHits> {
    const params = saved.params as Record<string, string>;
    const window = { publishedAfter: saved.lastCheckedAt, publishedUntil: until };
    const web = this.env.WEB_URL;
    if (saved.kind === 'DEALS') {
      const { query } = parseDealSearchParams(params);
      const result = await this.deals.search({ ...query, sort: 'neueste', page: 1, pageSize: ALERT_LISTINGS }, window);
      return { total: result.total, lines: result.items.map((d) => ({ title: d.title, price: formatPriceCents(d.priceCents), url: `${web}/deals/${d.id}` })) };
    }
    if (saved.kind === 'SERVICES') {
      const { query } = parseServiceSearchParams(params);
      const result = await this.services.search({ ...query, sort: 'neueste', page: 1, pageSize: ALERT_LISTINGS }, window);
      return { total: result.total, lines: result.items.map((p) => ({ title: `${p.headline} – ${p.provider.name}`, price: '', url: `${web}/dienstleistungen/${p.id}` })) };
    }
    const { query, categoryPath } = await this.search.resolveParams(params);
    query.sort = 'neueste';
    query.page = 1;
    query.pageSize = ALERT_LISTINGS;
    const result = await this.search.search(query, categoryPath, { ...window, topAds: false });
    return {
      total: result.total,
      lines: result.items.map((item) => ({
        title: item.title,
        price: item.salary ?? (item.priceType === 'FREE' ? 'Zu verschenken' : item.priceCents !== null ? formatPriceCents(item.priceCents) : ''),
        url: `${web}/anzeige/${item.id}`,
      })),
    };
  }

  private async alert(saved: SavedSearch & { user: { email: string; displayName: string } }, until: Date): Promise<boolean> {
    const params = saved.params as Record<string, string>;
    const result = await this.hits(saved, until);
    if (result.total > 0) {
      const searchUrl = `${this.env.WEB_URL}${SAVED_SEARCH_PATHS[saved.kind]}?${new URLSearchParams({ ...params, sortierung: 'neueste' })}`;
      const settingsUrl = `${this.env.WEB_URL}/konto/suchen`;
      const words = KIND_WORDS[saved.kind];
      const count = result.total === 1 ? words.one : `${result.total.toLocaleString('de-AT')} ${words.many}`;
      const { lines } = result;
      await this.mail.send({
        to: saved.user.email,
        subject: `${count[0]!.toUpperCase()}${count.slice(1)} für „${saved.name}“`.replace(/[\r\n]+/g, ' '),
        text: [
          `Hallo ${saved.user.displayName},`,
          '',
          `für deine gespeicherte Suche „${saved.name}“ gibt es ${count}:`,
          '',
          ...lines.map((l) => `- ${l.title}${l.price ? ` (${l.price})` : ''}: ${l.url}`),
          '',
          `Alle Treffer: ${searchUrl}`,
          '',
          `Benachrichtigung abschalten: ${settingsUrl}`,
        ].join('\n'),
        html: mailLayout({
          heading: `${count[0]!.toUpperCase()}${count.slice(1)} für „${saved.name}“`,
          paragraphs: [
            `Hallo ${escapeHtml(saved.user.displayName)},`,
            `für deine gespeicherte Suche gibt es ${escapeHtml(count)}:`,
            lines
              .map((l) => `<a href="${escapeHtml(l.url)}" style="color:#0f4c3a">${escapeHtml(l.title)}</a>${l.price ? ` – ${escapeHtml(l.price)}` : ''}`)
              .join('<br>'),
          ],
          action: { label: 'Alle Treffer ansehen', url: searchUrl },
          settingsUrl,
        }),
      });
    }
    await this.prisma.savedSearch.update({
      where: { id: saved.id },
      data: { lastCheckedAt: until, ...(result.total > 0 ? { lastNotifiedAt: new Date() } : {}) },
    });
    return result.total > 0;
  }

  /** Prüft die Parameter mit derselben Logik wie die jeweilige Suche und bringt sie in kanonische Form */
  private async canonicalParams(kind: SavedSearchKind, raw: Record<string, string>): Promise<Record<string, string>> {
    const empty = () => new BadRequestException('Bitte wähle mindestens einen Suchbegriff oder Filter, bevor du die Suche speicherst.');
    const invalid = (issues: { param: string; message: string }[]) =>
      new BadRequestException({ statusCode: 400, message: 'Bitte prüfe die Suchparameter.', errors: issues.map((i) => ({ path: i.param, message: i.message })) });
    let params: Record<string, string>;
    if (kind === 'DEALS') {
      const { query, issues } = parseDealSearchParams(raw);
      if (issues.length) throw invalid(issues);
      if (!hasActiveDealFilters(query)) throw empty();
      params = toDealSearchParams(query);
    } else if (kind === 'SERVICES') {
      const { query, issues } = parseServiceSearchParams(raw);
      if (issues.length) throw invalid(issues);
      if (!hasActiveServiceFilters(query)) throw empty();
      params = toServiceSearchParams(query);
    } else {
      const { query, filters } = await this.search.resolveParams(raw);
      if (!hasActiveFilters(query)) throw empty();
      params = toSearchParams(query, filters);
    }
    for (const key of VOLATILE_PARAMS) delete params[key];
    return params;
  }

  private async requireOwn(user: AuthUser, id: string): Promise<SavedSearch> {
    const row = ENTITY_ID.test(id) ? await this.prisma.savedSearch.findFirst({ where: { id, userId: user.id } }) : null;
    if (!row) throw new NotFoundException('Diese gespeicherte Suche gibt es nicht.');
    return row;
  }
}

/** Gleiche Suche = gleiche Parameter, unabhängig von der Reihenfolge */
export function queryKey(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
}

function toDto(row: SavedSearch): SavedSearchDto {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    params: row.params as Record<string, string>,
    labels: row.labels,
    notify: row.notify,
    createdAt: row.createdAt.toISOString(),
    lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
  };
}
