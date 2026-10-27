import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, BadRequestException } from '@nestjs/common';
import {
  formatPriceCents,
  hasActiveFilters,
  MAX_SAVED_SEARCHES,
  toSearchParams,
  type CreateSavedSearchInput,
  type SavedSearch as SavedSearchDto,
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

const ALERT_JOB = 'saved-search-alerts';
/** Neue Inserate brauchen kurz, bis sie im Suchindex stehen – so weit hinter „jetzt“ endet das Prüffenster */
const INDEX_LAG_MS = 2 * 60_000;
const ALERT_BATCH = 100;
const ALERT_LISTINGS = 5;

/** Parameter, die nicht zur gespeicherten Suche gehören */
const VOLATILE_PARAMS = ['seite', 'pageSize'];

@Injectable()
export class SavedSearchesService implements OnModuleInit {
  private readonly logger = new Logger(SavedSearchesService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ListingSearchService,
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
    const params = await this.canonicalParams(input.params);
    if ((await this.prisma.savedSearch.count({ where: { userId: user.id } })) >= MAX_SAVED_SEARCHES) {
      throw new BadRequestException(`Du kannst höchstens ${MAX_SAVED_SEARCHES} Suchen speichern. Lösche zuerst eine alte.`);
    }
    try {
      const row = await this.prisma.savedSearch.create({
        data: { userId: user.id, name: input.name, params, queryKey: queryKey(params), labels: input.labels, notify: input.notify },
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
   * Sucht für alle Suchen mit Benachrichtigung nach Inseraten, die seit der letzten Prüfung veröffentlicht wurden,
   * und schickt je Suche höchstens eine E-Mail. Jedes Inserat wird je Suche nur einmal gemeldet (Zeitfenster).
   */
  async runAlerts(now = new Date()): Promise<{ checked: number; notified: number }> {
    const until = new Date(now.getTime() - INDEX_LAG_MS);
    let checked = 0;
    let notified = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.savedSearch.findMany({
        where: {
          notify: true,
          lastCheckedAt: { lt: until },
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

  private async alert(saved: SavedSearch & { user: { email: string; displayName: string } }, until: Date): Promise<boolean> {
    const params = saved.params as Record<string, string>;
    const { query, categoryPath } = await this.search.resolveParams(params);
    query.sort = 'neueste';
    query.page = 1;
    query.pageSize = ALERT_LISTINGS;
    const result = await this.search.search(query, categoryPath, { publishedAfter: saved.lastCheckedAt, publishedUntil: until });
    if (result.total > 0) {
      const searchUrl = `${this.env.WEB_URL}/suche?${new URLSearchParams({ ...params, sortierung: 'neueste' })}`;
      const settingsUrl = `${this.env.WEB_URL}/konto/suchen`;
      const count = result.total === 1 ? 'eine neue Anzeige' : `${result.total.toLocaleString('de-AT')} neue Anzeigen`;
      const lines = result.items.map((item) => ({
        title: item.title,
        price: item.salary ?? (item.priceType === 'FREE' ? 'Zu verschenken' : item.priceCents !== null ? formatPriceCents(item.priceCents) : ''),
        url: `${this.env.WEB_URL}/anzeige/${item.id}`,
      }));
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

  private async canonicalParams(raw: Record<string, string>): Promise<Record<string, string>> {
    const { query, filters } = await this.search.resolveParams(raw);
    if (!hasActiveFilters(query)) {
      throw new BadRequestException('Bitte wähle mindestens einen Suchbegriff oder Filter, bevor du die Suche speicherst.');
    }
    const params = toSearchParams(query, filters);
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
    name: row.name,
    params: row.params as Record<string, string>,
    labels: row.labels,
    notify: row.notify,
    createdAt: row.createdAt.toISOString(),
    lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
  };
}
