import sharp from 'sharp';
import { InvalidImageError, processImage } from './image-processor.js';

/** Testbild mit Kamera-Metadaten inkl. GPS-Position und Ausrichtung „90° gedreht“. */
async function jpegWithExif(width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'TestCam', Model: 'X100', Artist: 'Max Mustermann' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '48/1 12/1 30/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '16/1 22/1 20/1',
      },
    })
    .toBuffer();
}

const solid = (format: 'png' | 'webp' | 'gif', width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 90, alpha: 1 } } })
    .toFormat(format)
    .toBuffer();

describe('processImage', () => {
  it('entfernt EXIF/GPS, wendet die Ausrichtung an und erzeugt WebP-Varianten', async () => {
    const input = await jpegWithExif();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(input.includes(Buffer.from('Mustermann'))).toBe(true);

    const result = await processImage(input);
    expect(result.detectedType).toBe('image/jpeg');
    // Ausrichtung 6 = 90° im Uhrzeigersinn: aus 800 × 600 wird 600 × 800
    expect([result.width, result.height]).toEqual([600, 800]);
    expect(result.variants.map((v) => v.name)).toEqual(['large', 'thumb']);

    for (const variant of result.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(variant.body.includes(Buffer.from('Mustermann'))).toBe(false);
    }
    const thumb = result.variants.find((v) => v.name === 'thumb')!;
    expect([thumb.width, thumb.height]).toEqual([480, 360]);
  });

  it('verkleinert große Bilder auf höchstens 1600 px und vergrößert kleine nicht', async () => {
    const big = await processImage(await solid('png', 4000, 2000));
    expect([big.width, big.height]).toEqual([1600, 800]);
    const small = await processImage(await solid('webp', 300, 250));
    expect(small.detectedType).toBe('image/webp');
    expect([small.width, small.height]).toEqual([300, 250]);
  });

  it('erkennt PNG am Inhalt', async () => {
    expect((await processImage(await solid('png'))).detectedType).toBe('image/png');
  });

  it('lehnt Dateien ab, die keine erlaubten Bilder sind', async () => {
    await expect(
      processImage(Buffer.from('Das ist kein Bild, nur Text mit .jpg-Endung')),
    ).rejects.toThrow(InvalidImageError);
    await expect(processImage(await solid('gif'))).rejects.toThrow(
      'Erlaubt sind nur JPEG, PNG oder WebP.',
    );
    await expect(
      processImage(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>'),
      ),
    ).rejects.toThrow(InvalidImageError);
  });

  it('lehnt zu kleine und abgeschnittene Bilder ab', async () => {
    await expect(processImage(await solid('png', 120, 120))).rejects.toThrow('zu klein');
    const jpeg = await jpegWithExif(1200, 900);
    await expect(processImage(jpeg.subarray(0, Math.floor(jpeg.length / 2)))).rejects.toThrow(
      InvalidImageError,
    );
  });
});
