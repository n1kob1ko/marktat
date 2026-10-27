import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { SavedSearchesService } from '../src/saved-searches/saved-searches.service.js';
import { createTestApp, flushSearch, mailsTo, mailText, publishListing, resetData, signIn } from './helpers.js';

describe('Gespeicherte Suchen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const bmw = {
    name: 'BMW 3er bis 20.000 € um Wien',
    params: { q: 'BMW 3er', preis_bis: '20000', plz: '1010', umkreis: '50', seite: '3' },
    labels: ['„BMW 3er“', 'bis 20.000 €', '50 km um 1010 Wien'],
  };

  it('verlangt eine Anmeldung', async () => {
    await request(server()).get('/v1/me/searches').expect(401);
    await request(server()).post('/v1/me/searches').send(bmw).expect(401);
  });

  it('speichert, listet, benennt um, schaltet Benachrichtigungen und löscht', async () => {
    const user = await signIn(app);
    const created = await request(server()).post('/v1/me/searches').set(user.auth).send(bmw).expect(201);
    expect(created.body).toMatchObject({
      name: bmw.name,
      // kanonisch: ohne Seitenzahl, Werte wie von der Suche verstanden
      params: { q: 'BMW 3er', preis_bis: '20000', plz: '1010', umkreis: '50' },
      labels: bmw.labels,
      notify: false,
    });
    expect(created.body.params.seite).toBeUndefined();

    const list = await request(server()).get('/v1/me/searches').set(user.auth).expect(200);
    expect(list.body).toHaveLength(1);

    const renamed = await request(server())
      .patch(`/v1/me/searches/${created.body.id}`)
      .set(user.auth)
      .send({ name: 'Mein Dreier', notify: true })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Mein Dreier', notify: true });

    await request(server()).patch(`/v1/me/searches/${created.body.id}`).set(user.auth).send({}).expect(400);
    await request(server()).delete(`/v1/me/searches/${created.body.id}`).set(user.auth).expect(204);
    expect((await request(server()).get('/v1/me/searches').set(user.auth).expect(200)).body).toEqual([]);
  });

  it('erkennt dieselbe Suche unabhängig von der Reihenfolge der Parameter', async () => {
    const user = await signIn(app);
    await request(server()).post('/v1/me/searches').set(user.auth).send(bmw).expect(201);
    const reordered = { umkreis: '50', plz: '1010', preis_bis: '20000', q: 'BMW 3er' };
    const res = await request(server()).post('/v1/me/searches').set(user.auth).send({ ...bmw, params: reordered }).expect(409);
    expect(res.body.message).toContain('bereits gespeichert');
  });

  it('prüft die Parameter mit der Suchlogik', async () => {
    const user = await signIn(app);
    const bad = (params: Record<string, string>, name = 'Test') =>
      request(server()).post('/v1/me/searches').set(user.auth).send({ name, params }).expect(400);
    await bad({ kategorie: 'gibt/es/nicht' });
    await bad({ plz: '99999' });
    await bad({ umkreis: '50' });
    await bad({ sortierung: 'zufall', q: 'x' });
    await bad({}); // ohne Suchbegriff oder Filter
    await bad({ q: 'x'.repeat(101) });
    await bad({ q: 'Fahrrad' }, '');
    await bad({ q: 'Fahrrad' }, 'x'.repeat(81));
    const tooMany = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 'v']));
    await bad(tooMany);
    // Unbekannte Parameter werden ignoriert, nicht gespeichert
    const ok = await request(server())
      .post('/v1/me/searches')
      .set(user.auth)
      .send({ name: 'Fahrräder', params: { q: 'Fahrrad', '<script>': 'alert(1)' } })
      .expect(201);
    expect(ok.body.params).toEqual({ q: 'Fahrrad' });
  });

  it('lässt fremde Suchen weder lesen noch ändern noch löschen', async () => {
    const owner = await signIn(app);
    const other = await signIn(app);
    const created = await request(server()).post('/v1/me/searches').set(owner.auth).send(bmw).expect(201);
    expect((await request(server()).get('/v1/me/searches').set(other.auth).expect(200)).body).toEqual([]);
    await request(server()).patch(`/v1/me/searches/${created.body.id}`).set(other.auth).send({ name: 'Gekapert' }).expect(404);
    await request(server()).patch('/v1/me/searches/..%2F..%2Fadmin').set(other.auth).send({ name: 'x' }).expect(404);
    await request(server()).delete(`/v1/me/searches/${created.body.id}`).set(other.auth).expect(204);
    expect(await prisma.savedSearch.count({ where: { id: created.body.id, name: bmw.name } })).toBe(1);
  });

  it('benachrichtigt per E-Mail über neue passende Inserate, jedes nur einmal', async () => {
    const seller = await signIn(app);
    const user = await signIn(app);
    const quiet = await signIn(app);
    const alerts = app.get(SavedSearchesService);
    const search = { name: 'Rennräder Graz', params: { q: 'Rennrad', plz: '8010', umkreis: '25' }, notify: true };
    await request(server()).post('/v1/me/searches').set(user.auth).send(search).expect(201);
    // Ohne Benachrichtigung bzw. mit abgeschalteter E-Mail: keine Nachricht
    await request(server()).post('/v1/me/searches').set(quiet.auth).send({ ...search, notify: false }).expect(201);

    await publishListing(app, seller.auth, { title: 'Rennrad Alu 54 cm' });
    await publishListing(app, seller.auth, { title: 'Kinderwagen', description: 'Gut erhaltener Kinderwagen mit Zubehör.' });
    await flushSearch();

    const later = new Date(Date.now() + 5 * 60_000);
    const first = await alerts.runAlerts(later);
    expect(first).toEqual({ checked: 1, notified: 1 });
    const mails = await mailsTo(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.Subject).toBe('Eine neue Anzeige für „Rennräder Graz“');
    const text = await mailText(mails[0]!.ID);
    expect(text).toContain('Rennrad Alu 54 cm');
    expect(text).not.toContain('Kinderwagen');
    expect(await mailsTo(quiet.email)).toHaveLength(0);

    // Zweiter Lauf: nichts Neues, keine weitere E-Mail
    const second = await alerts.runAlerts(new Date(later.getTime() + 60_000));
    expect(second.notified).toBe(0);
    expect(await mailsTo(user.email)).toHaveLength(1);

    // E-Mails abgeschaltet: Suche wird gar nicht mehr geprüft
    await request(server()).patch('/v1/me/notifications').set(user.auth).send({ notifySearchesByEmail: false }).expect(200);
    expect((await alerts.runAlerts(new Date(later.getTime() + 10 * 60_000))).checked).toBe(0);
  });
});
