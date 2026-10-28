import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MAX_SEARCH_PAGE,
  parseProjectSearchParams,
  PROJECT_EXTEND_WINDOW_DAYS,
  PROJECT_MAX_CONTACTS,
  PROJECT_MAX_OPEN,
  PROJECT_RUN_DAYS,
  type MyServiceProject,
  type MyServiceProjects,
  type ProjectSearchQuery,
  type ProjectSearchResult,
  type RawSearchParams,
  type ServiceProjectDetail,
  type ServiceProjectFields,
} from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { ServiceProjectStatus } from '../generated/prisma/enums.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { GeoService, locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { projectInclude, toProjectDetail, toProjectSummary, type ProjectRow } from './projects.mapper.js';
import { isProjectPublic, publicProjectWhere, publicServiceProfileWhere } from './visibility.js';

const DAY_MS = 86_400_000;
const NOT_FOUND = 'Diesen Projektauftrag gibt es nicht.';
const RESUBMIT_REVIEW_REASON = 'Nach einer Ablehnung überarbeitet und erneut eingereicht.';
/** Entwürfe und beendete Aufträge zählen hier mit – Schutz vor massenhaftem Anlegen */
const MAX_PROJECTS_TOTAL = 50;
/** Zählt für die Höchstzahl gleichzeitig offener Aufträge */
const OPEN_STATUSES: ServiceProjectStatus[] = ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'];

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function fieldError(message: string, issues: { path: string; message: string }[]) {
  return new BadRequestException({ statusCode: 400, message, errors: issues });
}

/**
 * Projektaufträge: Jemand beschreibt ein konkretes Vorhaben und sucht dafür eine selbstständige Dienstleistung.
 * Keine Ausschreibung: keine Gebote, keine öffentlichen Angebote und keine Vergabe über MarktAT. Anbieter:innen mit
 * sichtbarem Profil schreiben über die Nachrichten (höchstens PROJECT_MAX_CONTACTS je Auftrag).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
    private readonly moderation: ModerationService,
  ) {}

  // --- Eigene Aufträge ----------------------------------------------------------------

  async mine(user: AuthUser): Promise<MyServiceProjects> {
    const rows = await this.prisma.serviceProject.findMany({ where: { userId: user.id, status: { not: 'DELETED' } }, include: projectInclude, orderBy: { updatedAt: 'desc' } });
    const projects = await Promise.all(rows.map((row) => this.toMine(row)));
    return { projects, openCount: await this.openCount(user.id), maxOpen: PROJECT_MAX_OPEN };
  }

  async mineOne(user: AuthUser, id: string): Promise<MyServiceProject> {
    return this.toMine(await this.requireOwn(user, id));
  }

  async create(user: AuthUser, input: ServiceProjectFields, ip?: string): Promise<MyServiceProject> {
    const total = await this.prisma.serviceProject.count({ where: { userId: user.id, status: { not: 'DELETED' } } });
    if (total >= MAX_PROJECTS_TOTAL) throw new ConflictException('Du hast schon sehr viele Aufträge angelegt. Bitte lösche alte Entwürfe oder beendete Aufträge.');
    const fields = await this.fields(input);
    const row = await this.prisma.serviceProject.create({ data: { ...fields, userId: user.id }, include: projectInclude });
    this.audit.log({ action: 'project.created', actorId: user.id, entityType: 'service_project', entityId: row.id, ip });
    return this.toMine(row);
  }

  async update(user: AuthUser, id: string, input: ServiceProjectFields, ip?: string): Promise<MyServiceProject> {
    const project = await this.requireOwn(user, id);
    if (project.status === 'CLOSED') throw new ConflictException('Beendete Aufträge können nicht mehr bearbeitet werden.');
    const fields = await this.fields(input);
    const row = await this.prisma.serviceProject.update({ where: { id: project.id }, data: fields, include: projectInclude });
    this.audit.log({ action: 'project.updated', actorId: user.id, entityType: 'service_project', entityId: row.id, ip });
    return this.toMine(row);
  }

  /** Veröffentlichen mit Bestätigung; sichtbar für PROJECT_RUN_DAYS Tage */
  async publish(user: AuthUser, id: string, ip?: string): Promise<MyServiceProject> {
    const project = await this.requireOwn(user, id);
    if (project.status !== 'DRAFT') throw new ConflictException('Nur Entwürfe können veröffentlicht werden.');
    await this.assertOpenLimit(user.id);
    const now = new Date();
    await this.prisma.serviceProject.updateMany({
      where: { id: project.id, status: 'DRAFT' },
      data: { status: 'ACTIVE', confirmedAt: now, publishedAt: project.publishedAt ?? now, expiresAt: new Date(now.getTime() + PROJECT_RUN_DAYS * DAY_MS) },
    });
    this.audit.log({ action: 'project.published', actorId: user.id, entityType: 'service_project', entityId: project.id, ip });
    return this.mineOne(user, id);
  }

  pause(user: AuthUser, id: string, ip?: string) {
    return this.transition(user, id, ['ACTIVE'], 'PAUSED', 'project.paused', 'Nur sichtbare Aufträge können pausiert werden.', ip);
  }

  async resume(user: AuthUser, id: string, ip?: string) {
    return this.transition(user, id, ['PAUSED'], 'ACTIVE', 'project.resumed', 'Nur pausierte Aufträge können fortgesetzt werden.', ip);
  }

  /** Beenden, z. B. weil jemand gefunden wurde. Bestehende Unterhaltungen bleiben, neue Anfragen gibt es nicht mehr. */
  close(user: AuthUser, id: string, ip?: string) {
    return this.transition(user, id, ['ACTIVE', 'PAUSED'], 'CLOSED', 'project.closed', 'Nur sichtbare oder pausierte Aufträge können beendet werden.', ip, { closedAt: new Date() });
  }

  /** Laufzeit verlängern: frühestens PROJECT_EXTEND_WINDOW_DAYS Tage vor dem Ende, dann wieder PROJECT_RUN_DAYS Tage ab heute */
  async extend(user: AuthUser, id: string, ip?: string): Promise<MyServiceProject> {
    const project = await this.requireOwn(user, id);
    if (project.status !== 'ACTIVE' && project.status !== 'PAUSED') throw new ConflictException('Nur sichtbare oder pausierte Aufträge können verlängert werden.');
    const now = Date.now();
    if (project.expiresAt && project.expiresAt.getTime() - now > PROJECT_EXTEND_WINDOW_DAYS * DAY_MS) {
      throw new ConflictException(`Verlängern ist erst in den letzten ${PROJECT_EXTEND_WINDOW_DAYS} Tagen der Laufzeit möglich.`);
    }
    await this.prisma.serviceProject.update({ where: { id: project.id }, data: { expiresAt: new Date(now + PROJECT_RUN_DAYS * DAY_MS) } });
    this.audit.log({ action: 'project.extended', actorId: user.id, entityType: 'service_project', entityId: project.id, ip });
    return this.mineOne(user, id);
  }

  /** Abgelehnten Auftrag nach einer Überarbeitung erneut zur Prüfung einreichen */
  async resubmit(user: AuthUser, id: string, ip?: string): Promise<MyServiceProject> {
    const project = await this.requireOwn(user, id);
    if (project.status !== 'REJECTED') throw new ConflictException('Nur abgelehnte Aufträge können erneut eingereicht werden.');
    const decision = await this.prisma.moderationDecision.findFirst({ where: { projectId: project.id, action: 'PROJECT_REJECTED' }, orderBy: { createdAt: 'desc' } });
    if (decision && project.updatedAt <= decision.createdAt) throw new ConflictException('Bitte überarbeite den Auftrag, bevor du ihn erneut einreichst.');
    await this.assertOpenLimit(user.id);
    const updated = await this.prisma.serviceProject.updateMany({ where: { id: project.id, status: 'REJECTED' }, data: { status: 'PENDING_REVIEW', reviewReason: RESUBMIT_REVIEW_REASON } });
    if (!updated.count) throw new ConflictException('Der Status des Auftrags hat sich inzwischen geändert.');
    this.audit.log({ action: 'project.resubmitted', actorId: user.id, entityType: 'service_project', entityId: project.id, ip, metadata: { decisionId: decision?.id } });
    return this.mineOne(user, id);
  }

  /** Löschen: verschwindet sofort; die Zeile bleibt (Status DELETED) für bestehende Unterhaltungen und Entscheidungen */
  async remove(user: AuthUser, id: string, ip?: string) {
    const project = await this.requireOwn(user, id);
    await this.prisma.serviceProject.update({ where: { id: project.id }, data: { status: 'DELETED', reviewReason: null } });
    this.audit.log({ action: 'project.deleted', actorId: user.id, entityType: 'service_project', entityId: project.id, ip });
  }

  // --- Öffentlich ---------------------------------------------------------------------

  async findOne(id: string, viewer?: AuthUser): Promise<ServiceProjectDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException(NOT_FOUND);
    const row = await this.prisma.serviceProject.findUnique({ where: { id }, include: projectInclude });
    if (!row || row.status === 'DELETED') throw new NotFoundException(NOT_FOUND);
    const isOwner = viewer?.id === row.userId;
    const isStaff = viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR';
    const isPublic = isProjectPublic(row);
    if (!isPublic && !isOwner && !isStaff) throw new NotFoundException('Dieser Projektauftrag ist nicht mehr verfügbar.');
    const conversation = viewer && !isOwner
      ? await this.prisma.conversation.findUnique({ where: { projectId_buyerId: { projectId: id, buyerId: viewer.id } }, select: { id: true } })
      : null;
    if (!isOwner && isPublic) {
      // Rohes SQL: Aufrufe ändern den Auftrag nicht (updatedAt bleibt)
      await this.prisma.$executeRaw`UPDATE service_projects SET view_count = view_count + 1 WHERE id = ${id}`;
    }
    const contact = viewer && !isOwner ? await this.contactState(viewer, row, Boolean(conversation)) : null;
    const detail = toProjectDetail(row, { isOwner, conversationId: conversation?.id ?? null, contact });
    if (isOwner || isStaff) detail.moderation = await this.moderation.projectModerationInfo(row);
    return detail;
  }

  async searchParams(raw: RawSearchParams): Promise<ProjectSearchResult> {
    const { query, issues } = parseProjectSearchParams(raw);
    if (issues.length) {
      throw new BadRequestException({ statusCode: 400, message: 'Bitte prüfe die Suchparameter.', errors: issues.map((i) => ({ path: i.param, message: i.message })) });
    }
    return this.search(query);
  }

  /**
   * Suche direkt in PostgreSQL/PostGIS. Ein Ort passt bei gleicher PLZ oder im gesuchten Umkreis; mit „remote“
   * zählen nur Aufträge, die remote erledigt werden können, unabhängig vom Ort.
   */
  async search(query: ProjectSearchQuery): Promise<ProjectSearchResult> {
    const center = await this.resolveCenter(query);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.status = 'ACTIVE'`,
      Prisma.sql`p.expires_at > now()`,
      Prisma.sql`u.status = 'ACTIVE'`,
      Prisma.sql`u.deleted_at IS NULL`,
    ];
    if (query.q) {
      for (const word of query.q.split(' ').slice(0, 10)) {
        const pattern = `%${escapeLike(word)}%`;
        conditions.push(Prisma.sql`(p.title ILIKE ${pattern} OR p.description ILIKE ${pattern} OR c.name ILIKE ${pattern})`);
      }
    }
    if (query.category) conditions.push(Prisma.sql`c.slug = ${query.category}`);
    else if (query.group) conditions.push(Prisma.sql`c.group_slug = ${query.group}`);
    const point = center ? Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography` : null;
    if (query.remote) conditions.push(Prisma.sql`p.remote`);
    else if (center && point) {
      conditions.push(Prisma.sql`(loc.id IS NOT NULL AND (loc.postal_code = ${center.postalCode} OR ST_DWithin(loc.geom, ${point}, ${query.radiusKm ?? 0}::int * 1000)))`);
    }
    const newest = Prisma.sql`p.published_at DESC NULLS LAST, p.id COLLATE "C" DESC`;
    const order = query.sort === 'entfernung' && point ? Prisma.sql`ST_Distance(loc.geom, ${point}) ASC NULLS LAST, ${newest}` : newest;
    const from = Prisma.sql`FROM service_projects p JOIN users u ON u.id = p.user_id JOIN service_categories c ON c.id = p.category_id
      LEFT JOIN locations loc ON loc.id = p.location_id WHERE ${Prisma.join(conditions, ' AND ')}`;
    const offset = (query.page - 1) * query.pageSize;
    const [ids, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id ${from} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
    ]);
    const rows = ids.length ? await this.prisma.serviceProject.findMany({ where: { id: { in: ids.map((r) => r.id) }, ...publicProjectWhere() }, include: projectInclude }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [toProjectSummary(row, center)] : [];
    });
    const total = Number(count[0]?.total ?? 0);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.min(Math.ceil(total / query.pageSize), MAX_SEARCH_PAGE),
      location: center?.summary ?? null,
    };
  }

  // --- intern -------------------------------------------------------------------------

  /** Ob die angemeldete Person anschreiben kann – dieselben Regeln prüft MessagesService beim Senden */
  private async contactState(viewer: AuthUser, row: ProjectRow, hasConversation: boolean): Promise<ServiceProjectDetail['contact']> {
    if (hasConversation) return { allowed: true, reason: null };
    if (!isProjectPublic(row)) return { allowed: false, reason: 'Dieser Auftrag nimmt keine Anfragen an.' };
    if (row._count.conversations >= PROJECT_MAX_CONTACTS) return { allowed: false, reason: 'Für diesen Auftrag gibt es schon viele Anfragen. Neue Anfragen sind nicht mehr möglich.' };
    const profile = await this.prisma.serviceProfile.findFirst({ where: { userId: viewer.id, ...publicServiceProfileWhere() }, select: { id: true } });
    if (!profile) return { allowed: false, reason: 'Antworten können nur Anbieter:innen mit sichtbarem Anbieterprofil.' };
    return { allowed: true, reason: null };
  }

  private async toMine(row: ProjectRow): Promise<MyServiceProject> {
    const detail = toProjectDetail(row, { isOwner: true, conversationId: null, contact: null });
    detail.moderation = await this.moderation.projectModerationInfo(row);
    return {
      ...detail,
      contactCount: row._count.conversations,
      viewCount: row.viewCount,
      reviewReason: row.reviewReason,
      expired: (row.status === 'ACTIVE' || row.status === 'PAUSED') && row.expiresAt !== null && row.expiresAt <= new Date(),
    };
  }

  private async fields(input: ServiceProjectFields) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { slug: input.categorySlug }, select: { id: true, isActive: true } });
    if (!category?.isActive) throw fieldError('Unbekannte Kategorie.', [{ path: 'categorySlug', message: 'Bitte wähle eine Kategorie aus der Liste.' }]);
    if (input.locationId) {
      const location = await this.prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true } });
      if (!location) throw fieldError('Diesen Ort kennen wir nicht.', [{ path: 'locationId', message: 'Bitte wähle einen Ort aus der Liste.' }]);
    }
    return {
      title: input.title,
      description: input.description,
      categoryId: category.id,
      locationId: input.locationId ?? null,
      remote: input.remote,
      budgetType: input.budgetType,
      budgetCents: input.budgetCents,
      timeframe: input.timeframe,
    };
  }

  private openCount(userId: string) {
    return this.prisma.serviceProject.count({ where: { userId, status: { in: OPEN_STATUSES }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  }

  private async assertOpenLimit(userId: string) {
    if ((await this.openCount(userId)) >= PROJECT_MAX_OPEN) {
      throw new ConflictException(`Du hast schon ${PROJECT_MAX_OPEN} offene Aufträge. Bitte beende oder pausiere zuerst einen.`);
    }
  }

  private async transition(
    user: AuthUser,
    id: string,
    from: ServiceProjectStatus[],
    to: ServiceProjectStatus,
    action: AuditAction,
    message: string,
    ip?: string,
    extra: Prisma.ServiceProjectUpdateManyMutationInput = {},
  ): Promise<MyServiceProject> {
    const project = await this.requireOwn(user, id);
    if (!from.includes(project.status)) throw new ConflictException(message);
    const updated = await this.prisma.serviceProject.updateMany({ where: { id: project.id, status: { in: from } }, data: { status: to, ...extra } });
    if (!updated.count) throw new ConflictException('Der Status des Auftrags hat sich inzwischen geändert.');
    this.audit.log({ action, actorId: user.id, entityType: 'service_project', entityId: project.id, ip });
    return this.mineOne(user, id);
  }

  private async requireOwn(user: AuthUser, id: string): Promise<ProjectRow> {
    const row = ENTITY_ID.test(id) ? await this.prisma.serviceProject.findFirst({ where: { id, userId: user.id }, include: projectInclude }) : null;
    if (!row || row.status === 'DELETED') throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** Ort aus `ort` (ID) bzw. Hauptort der `plz` – wie in der Anbietersuche */
  private async resolveCenter(query: Pick<ProjectSearchQuery, 'locationId' | 'postalCode'>) {
    if (!query.locationId && !query.postalCode) return null;
    let location = query.locationId ? await this.prisma.location.findUnique({ where: { id: query.locationId }, include: locationInclude }) : null;
    if (!query.locationId && query.postalCode) {
      const [first] = await this.geo.searchLocations(query.postalCode, 1);
      location = first ? await this.prisma.location.findUnique({ where: { id: first.id }, include: locationInclude }) : null;
    }
    if (!location) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Diesen Ort kennen wir nicht.',
        errors: [{ path: query.locationId ? 'ort' : 'plz', message: 'Unbekannter Ort bzw. unbekannte Postleitzahl.' }],
      });
    }
    return { latitude: location.latitude, longitude: location.longitude, postalCode: location.postalCode, summary: toLocationSummary(location) };
  }
}
