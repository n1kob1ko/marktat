import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import sharp from 'sharp';
import {
  AUTOFILL_MAX_BYTES,
  AUTOFILL_MAX_PHOTOS,
  categoryAttributeSchema,
  coerceAttributeSuggestions,
  isUnlimitedAccount,
  type AutofillStatus,
  type AutofillSuggestion,
} from '@marktat/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CategoriesService } from '../categories/categories.service.js';
import { loadEnv, type Env } from '../config/env.js';
import { RATE_LIMIT_STORAGE, type RedisThrottlerStorage } from '../common/redis-throttler.storage.js';
import { autofillOutputSchema, systemPrompt, type AutofillOutput } from './autofill.prompt.js';

/** Längste Kante des Fotos für das Modell (größer bringt keine bessere Erkennung, kostet aber mehr) */
const MODEL_EDGE = 1568;
const MIN_EDGE = 200;
const MAX_INPUT_PIXELS = 60_000_000;
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Modelle, die die serverseitige Ausweichlösung bei Ablehnungen unterstützen (`fallbacks: "default"`) */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;

export class AutofillDisabledError extends ServiceUnavailableException {
  constructor() {
    super('Der Foto-Assistent ist derzeit nicht verfügbar. Bitte fülle die Angaben selbst aus.');
  }
}

/**
 * Foto-Assistent: ein bis vier Fotos → Vorschläge für Kategorie, Titel, Beschreibung und Zusatzangaben.
 * Die Fotos werden nur für diese eine Anfrage an die Claude-API (Anthropic) geschickt und nirgends gespeichert.
 */
@Injectable()
export class AutofillService {
  private readonly logger = new Logger(AutofillService.name);
  private readonly env: Env;
  private readonly client: Anthropic | null;
  /** Tageszähler, wenn kein Redis da ist (eine API-Instanz) */
  private readonly localCounts = new Map<string, number>();
  private localDay = '';

  constructor(
    private readonly categories: CategoriesService,
    @Optional() @Inject(RATE_LIMIT_STORAGE) private readonly storage: RedisThrottlerStorage | null = null,
    @Optional() @Inject('ANTHROPIC_CLIENT') client: Anthropic | null = null,
  ) {
    this.env = loadEnv();
    const enabled = this.env.AI_ENABLED && Boolean(this.env.ANTHROPIC_API_KEY);
    this.client = !enabled
      ? null
      : (client ??
        new Anthropic({
          apiKey: this.env.ANTHROPIC_API_KEY,
          baseURL: this.env.ANTHROPIC_BASE_URL,
          timeout: 60_000,
          maxRetries: 1,
        }));
  }

  status(): AutofillStatus {
    return { enabled: this.client !== null };
  }

  async suggest(user: AuthUser, body: unknown): Promise<AutofillSuggestion> {
    if (!this.client) throw new AutofillDisabledError();
    const images = await Promise.all(this.readImages(body).map((image) => this.prepareImage(image)));
    // Eine Auswertung zählt einmal, egal wie viele Fotos sie enthält
    await this.countUsage(user);

    const tree = await this.categories.tree();
    const output = await this.ask(this.client, images, systemPrompt(tree));
    return this.toSuggestion(output);
  }

  /** `{ images: [Base64, …] }` mit ein bis vier Fotos */
  private readImages(body: unknown): Buffer[] {
    const images = (body as { images?: unknown } | null)?.images;
    if (!Array.isArray(images) || images.length === 0 || !images.every((i) => typeof i === 'string' && i.length > 0)) {
      throw new BadRequestException('Bitte schicke mindestens ein Foto.');
    }
    if (images.length > AUTOFILL_MAX_PHOTOS) throw new BadRequestException(`Bitte schicke höchstens ${AUTOFILL_MAX_PHOTOS} Fotos.`);
    return (images as string[]).map((image) => {
      // Die Länge vor dem Dekodieren prüfen: Base64 ist ein Drittel größer als die Datei
      if (image.length > Math.ceil((AUTOFILL_MAX_BYTES * 4) / 3) + 4) throw new BadRequestException('Ein Foto ist zu groß.');
      return Buffer.from(image, 'base64');
    });
  }

  /** Datei prüfen, drehen (EXIF), Metadaten entfernen und verkleinern – es geht nur ein frisches JPEG hinaus. */
  private async prepareImage(image: Buffer): Promise<Buffer> {
    if (image.length === 0) throw new BadRequestException('Ein Foto ist leer.');
    try {
      const input = sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const meta = await input.metadata();
      if (!meta.format || !IMAGE_FORMATS.has(meta.format)) {
        throw new BadRequestException('Bitte verwende Fotos als JPEG, PNG oder WebP.');
      }
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_EDGE) {
        throw new BadRequestException('Ein Foto ist zu klein. Bitte mach ein schärferes Foto aus der Nähe.');
      }
      return await input
        .rotate()
        .resize({ width: MODEL_EDGE, height: MODEL_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('Ein Foto konnte nicht gelesen werden. Bitte versuche ein anderes Foto.');
    }
  }

  /**
   * Kostenbremse: Auswertungen je Konto und insgesamt je Tag (UTC). Gezählt wird jeder Versuch.
   * Administratorkonten haben kein Limit je Konto; die Obergrenze für alle zusammen (Kosten) gilt weiter.
   */
  private async countUsage(user: Pick<AuthUser, 'id' | 'role'>) {
    const day = new Date().toISOString().slice(0, 10);
    const perUser = await this.increment(`autofill:${day}:user:${user.id}`);
    if (!isUnlimitedAccount(user) && perUser > this.env.AI_AUTOFILL_USER_DAILY_LIMIT) {
      throw new HttpException('Du hast den Foto-Assistenten heute schon oft verwendet. Morgen geht es wieder.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const total = await this.increment(`autofill:${day}:total`);
    if (total > this.env.AI_AUTOFILL_DAILY_LIMIT) {
      if (total === this.env.AI_AUTOFILL_DAILY_LIMIT + 1) this.logger.warn('Tageslimit des Foto-Assistenten erreicht (AI_AUTOFILL_DAILY_LIMIT).');
      throw new HttpException('Der Foto-Assistent ist für heute ausgelastet. Bitte fülle die Angaben selbst aus.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async increment(key: string): Promise<number> {
    if (this.storage) {
      const record = await this.storage.increment(key, DAY_MS, Number.MAX_SAFE_INTEGER, 1, 'autofill');
      // totalHits 0 = Redis nicht erreichbar: dann zählt der Prozessspeicher
      if (record.totalHits > 0) return record.totalHits;
    }
    const day = key.split(':')[1]!;
    if (day !== this.localDay) {
      this.localCounts.clear();
      this.localDay = day;
    }
    const next = (this.localCounts.get(key) ?? 0) + 1;
    this.localCounts.set(key, next);
    return next;
  }

  private async ask(client: Anthropic, images: Buffer[], system: string): Promise<AutofillOutput> {
    const model = this.env.AI_MODEL;
    const fallback = FALLBACK_MODELS.test(model);
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        // Erkennen und Zuordnen braucht wenig Nachdenken – „low“ hält Antwortzeit und Kosten klein
        output_config: { effort: 'low', format: betaZodOutputFormat(autofillOutputSchema) },
        // Kategorieliste und Felder sind für alle Anfragen gleich und werden zwischengespeichert
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: image.toString('base64') },
              })),
              {
                type: 'text',
                text:
                  images.length === 1
                    ? 'Das ist mein Foto. Bitte schlag die Angaben für mein Inserat vor.'
                    : `Das sind ${images.length} Fotos von demselben Artikel. Bitte schlag die Angaben für mein Inserat vor.`,
              },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        this.logger.warn('Claude-API: Rate-Limit erreicht');
        throw new HttpException('Der Foto-Assistent ist gerade ausgelastet. Bitte versuche es gleich noch einmal.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        this.logger.error('Claude-API: Schlüssel ungültig oder ohne Berechtigung (ANTHROPIC_API_KEY prüfen)');
      } else if (error instanceof Anthropic.APIConnectionTimeoutError) {
        this.logger.warn('Claude-API: Zeitüberschreitung');
      } else if (error instanceof Anthropic.APIError) {
        this.logger.warn(`Claude-API: Fehler ${error.status ?? 'ohne Status'}`);
      } else {
        this.logger.warn(`Claude-API: ${(error as Error).message}`);
      }
      throw new HttpException('Das Foto konnte gerade nicht ausgewertet werden. Bitte versuche es noch einmal.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const { usage } = response;
    this.logger.log(
      `${images.length} Foto(s) ausgewertet (${response.model}): ${usage.input_tokens} Eingabe-, ${usage.cache_read_input_tokens ?? 0} Cache-, ${usage.output_tokens} Ausgabe-Tokens`,
    );
    if (response.stop_reason === 'refusal') {
      throw new UnprocessableEntityException('Dieses Foto können wir nicht auswerten. Bitte fülle die Angaben selbst aus.');
    }
    if (!response.parsed_output) {
      this.logger.warn(`Claude-API: keine verwertbare Antwort (stop_reason ${response.stop_reason})`);
      throw new HttpException('Das Foto konnte gerade nicht ausgewertet werden. Bitte versuche es noch einmal.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return response.parsed_output;
  }

  /** Antwort des Modells mit denselben Regeln wie beim Speichern prüfen; Ungültiges fällt weg. */
  async toSuggestion(output: AutofillOutput): Promise<AutofillSuggestion> {
    const empty: AutofillSuggestion = { recognized: false, categoryId: null, categoryPath: null, title: '', description: '', attributes: {} };
    if (!output.recognized) return empty;

    const category = output.categoryPath ? await this.categories.findByPath(output.categoryPath.trim()) : undefined;
    const leaf = category?.isActive && (await this.categories.isLeaf(category.id)) ? category : undefined;
    const schema = categoryAttributeSchema(leaf?.path);
    const title = output.title.replace(/\s+/g, ' ').trim().slice(0, 90);
    return {
      recognized: true,
      categoryId: leaf?.id ?? null,
      categoryPath: leaf?.path ?? null,
      title: title.length >= 3 ? title : '',
      description: output.description.trim().slice(0, 5000),
      attributes: leaf ? coerceAttributeSuggestions(schema, output.attributes) : {},
    };
  }
}
