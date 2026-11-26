import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { brandMarkSvg, WORDMARK } from '@/components/brand-mark';

/**
 * Vorschaubild für geteilte Links (WhatsApp, Facebook …): Foto rechts, grüner Verlauf links mit Logo und Spruch.
 * Logo und Schrift werden beim Build gezeichnet, ein neues Logo (components/brand-mark.tsx) landet also automatisch hier.
 * Die Fotos in assets/og sind schon auf 1200×630 zugeschnitten und enthalten weder Logo noch Text.
 */
export const ogSize = { width: 1200, height: 630 };
/** JPEG statt PNG: ein Foto als PNG wäre über 1 MB, WhatsApp zeigt so große Vorschaubilder oft gar nicht an */
export const ogContentType = 'image/jpeg';

const HERO = '11,58,44';

export async function brandOgImage(options: { photo: 'startseite' | 'deals' | 'dienstleistungen'; title: string; accent: string; sub: string }) {
  // Läuft beim Build (statisches Bild), Arbeitsverzeichnis ist apps/web
  const assets = join(process.cwd(), 'src/assets');
  const [photo, display, text] = await Promise.all([
    readFile(join(assets, 'og', `${options.photo}.jpg`)),
    readFile(join(assets, 'fonts/bricolage-grotesque-bold.ttf')),
    readFile(join(assets, 'fonts/inter-medium.ttf')),
  ]);
  const png = new ImageResponse(
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', background: `rgb(${HERO})` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse kennt nur <img> */}
      <img src={`data:image/jpeg;base64,${photo.toString('base64')}`} width={ogSize.width} height={ogSize.height} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundImage: `linear-gradient(90deg, rgba(${HERO},0.97) 0%, rgba(${HERO},0.9) 42%, rgba(${HERO},0.15) 78%, rgba(${HERO},0) 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 76,
          top: 72,
          bottom: 72,
          width: 720,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          color: '#f6f4ef',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {brandMarkSvg({ shape: '#f6f4ef', cutout: `rgb(${HERO})`, accent: '#f28c38' }, { width: 64, height: 64 })}
          <div style={{ display: 'flex', marginLeft: 18, fontFamily: 'Bricolage', fontSize: 52, letterSpacing: -1 }}>
            <span>{WORDMARK.main}</span>
            <span style={{ color: '#f28c38' }}>{WORDMARK.accent}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Bricolage', fontSize: 70, lineHeight: 1.04, letterSpacing: -1.6 }}>
            <span>{options.title}</span>
            <span style={{ color: '#f28c38' }}>{options.accent}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 18, fontFamily: 'Inter', fontSize: 30, color: 'rgba(246,244,239,0.88)' }}>{options.sub}</div>
        </div>
      </div>
    </div>,
    {
      ...ogSize,
      fonts: [
        { name: 'Bricolage', data: display, weight: 700, style: 'normal' },
        { name: 'Inter', data: text, weight: 500, style: 'normal' },
      ],
    },
  );
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { 'Content-Type': ogContentType, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
  });
}
