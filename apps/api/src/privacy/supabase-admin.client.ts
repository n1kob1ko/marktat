import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

export class AuthAdminUnavailableError extends Error {}

export interface AuthFactor {
  id: string;
  type: string;
  verified: boolean;
  friendlyName: string | null;
  createdAt: string;
}

/**
 * Zugriff auf die Supabase-Auth-Admin-API (GoTrue) mit dem Service-Role-Schlüssel – nur serverseitig.
 * Wird für die erneute Anmeldung vor der Kontolöschung, das Löschen des Auth-Kontos und die Verwaltung
 * der Zwei-Faktor-Anmeldung (Faktoren auflisten bzw. zurücksetzen) verwendet.
 */
@Injectable()
export class SupabaseAdminClient {
  private readonly logger = new Logger(SupabaseAdminClient.name);
  private readonly env = loadEnv();

  get configured() {
    return Boolean(this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  /** Prüft E-Mail und Passwort. Gibt die Benutzer-ID und das neue Access-Token zurück (oder null bei falschen Daten). */
  async verifyPassword(email: string, password: string): Promise<{ userId: string; accessToken: string } | null> {
    const response = await this.request('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (response.status === 400 || response.status === 401 || response.status === 422) return null;
    if (!response.ok) throw new AuthAdminUnavailableError(`Supabase Auth antwortet mit ${response.status}`);
    const data = (await response.json()) as { access_token?: string; user?: { id?: string } };
    if (!data.access_token || !data.user?.id) return null;
    return { userId: data.user.id, accessToken: data.access_token };
  }

  /** Beendet alle Sitzungen der Person (best effort). */
  async signOutEverywhere(accessToken: string): Promise<void> {
    await this.request('/logout?scope=global', { method: 'POST' }, accessToken).catch((error: Error) => {
      this.logger.warn(`Abmelden fehlgeschlagen: ${error.message}`);
    });
  }

  /** Löscht das Auth-Konto. Ein bereits gelöschtes Konto ist kein Fehler (Schritt ist wiederholbar). */
  async deleteUser(userId: string): Promise<void> {
    const response = await this.request(`/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (response.ok || response.status === 404) return;
    throw new AuthAdminUnavailableError(`Auth-Konto konnte nicht gelöscht werden (${response.status})`);
  }

  /** Faktoren der Zwei-Faktor-Anmeldung (ohne Geheimnisse) */
  async listFactors(userId: string): Promise<AuthFactor[]> {
    const response = await this.request(`/admin/users/${encodeURIComponent(userId)}/factors`, { method: 'GET' });
    if (response.status === 404) return [];
    if (!response.ok) throw new AuthAdminUnavailableError(`Faktoren konnten nicht gelesen werden (${response.status})`);
    const data = (await response.json()) as { id: string; factor_type: string; status: string; friendly_name?: string; created_at: string }[];
    return data.map((f) => ({
      id: f.id,
      type: f.factor_type,
      verified: f.status === 'verified',
      friendlyName: f.friendly_name ?? null,
      createdAt: f.created_at,
    }));
  }

  /** Entfernt einen Faktor. Ein bereits entfernter Faktor ist kein Fehler. */
  async deleteFactor(userId: string, factorId: string): Promise<void> {
    const response = await this.request(
      `/admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factorId)}`,
      { method: 'DELETE' },
    );
    if (response.ok || response.status === 404) return;
    throw new AuthAdminUnavailableError(`Faktor konnte nicht entfernt werden (${response.status})`);
  }

  private async request(path: string, init: RequestInit, bearer?: string): Promise<Response> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new AuthAdminUnavailableError('SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt.');
    try {
      return await fetch(`${this.env.SUPABASE_URL}/auth/v1${path}`, {
        ...init,
        headers: { apikey: key, Authorization: `Bearer ${bearer ?? key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new AuthAdminUnavailableError(`Supabase Auth nicht erreichbar: ${(error as Error).message}`);
    }
  }
}
