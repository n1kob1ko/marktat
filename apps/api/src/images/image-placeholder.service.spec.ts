import sharp from 'sharp';
import { ImagePlaceholderService } from './image-placeholder.service.js';

describe('ImagePlaceholderService', () => {
  it('trägt Platzhalter aus dem Vorschaubild nach und versucht unlesbare Bilder nicht erneut', async () => {
    const thumb = await sharp({ create: { width: 480, height: 360, channels: 3, background: { r: 30, g: 90, b: 160 } } })
      .webp()
      .toBuffer();
    const updates: { id: string; placeholder: string }[] = [];
    const prisma = {
      listingImage: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'gut', storageKey: 'listings/a/gut' },
          { id: 'fehlt', storageKey: 'listings/a/fehlt' },
        ]),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { placeholder: string } }) => {
          updates.push({ id: where.id, placeholder: data.placeholder });
          return { count: 1 };
        }),
      },
    };
    const storage = {
      getBytes: vi.fn(async (key: string) => {
        if (key === 'listings/a/gut/thumb.webp') return thumb;
        throw new Error('nicht gefunden');
      }),
    };
    const jobs = { register: vi.fn(), every: vi.fn() };
    const service = new ImagePlaceholderService(prisma as never, jobs as never, storage as never);

    service.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith('image-placeholders', expect.any(Function));

    await expect(service.backfill()).resolves.toEqual({ filled: 1, failed: 1 });
    expect(prisma.listingImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'READY', placeholder: null } }),
    );
    expect(updates[0]!.placeholder).toMatch(/^data:image\/webp;base64,/);
    expect(updates[1]).toEqual({ id: 'fehlt', placeholder: '' });
  });
});
