import { ExternalLink, MapPin } from 'lucide-react';
import { Card } from '@marktat/ui';
import type { LocationSummary } from '@marktat/shared';
import { AUSTRIA_DOTS } from './austria-dots';

/** Muss zu scripts/build-austria-map.mjs passen: Raster ab 9,5° O / 49,05° N, Schrittweite 0,07° (ca. 7,8 km) */
const MAP_GRID = { lon0: 9.5, lat0: 49.05, step: 0.07, cos: Math.cos((47.6 * Math.PI) / 180) };

/** Lage eines Punkts im Raster der Punktkarte (gleiche Projektion wie beim Erzeugen) */
export function mapPosition(point: { latitude: number; longitude: number }) {
  return {
    x: ((point.longitude - MAP_GRID.lon0) * MAP_GRID.cos) / MAP_GRID.step,
    y: (MAP_GRID.lat0 - point.latitude) / MAP_GRID.step,
  };
}

/**
 * Ungefährer Standort als Punktkarte von Österreich – ohne Kartendienst, es wird nichts nachgeladen.
 * Gezeigt wird nur der Mittelpunkt des Orts (PLZ + Ort), nie eine Adresse. OpenStreetMap öffnet sich erst auf Klick.
 */
export function AustriaMap({
  point,
  location,
}: {
  point: { latitude: number; longitude: number };
  location: LocationSummary;
}) {
  const { x, y } = mapPosition(point);
  const place = `${location.postalCode} ${location.place}`;
  const lat = point.latitude.toFixed(4);
  const lon = point.longitude.toFixed(4);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-1.5 font-sans text-base font-semibold tracking-normal text-ink-900">
        <MapPin className="size-4 text-brand-700" aria-hidden="true" /> Standort
      </h2>
      <svg
        viewBox={`-1 -1 ${AUSTRIA_DOTS.cols + 1} ${AUSTRIA_DOTS.rows + 1}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label={`Österreich-Karte mit dem ungefähren Standort ${place}, ${location.state}`}
      >
        <path
          d={AUSTRIA_DOTS.path}
          className="stroke-ink-300"
          strokeWidth={0.62}
          strokeLinecap="round"
          fill="none"
        />
        {/* Kreis statt Nadel: der Ort ist bewusst nur ungefähr */}
        <circle
          cx={x}
          cy={y}
          r={2.6}
          className="fill-brand-500/20 stroke-brand-600"
          strokeWidth={0.25}
        />
        <circle
          cx={x}
          cy={y}
          r={0.75}
          className="fill-brand-700 stroke-surface"
          strokeWidth={0.3}
        />
      </svg>
      <p className="mt-3 text-sm text-ink-700">
        Ungefährer Standort: <span className="font-semibold text-ink-900">{place}</span>
        {location.municipality && location.municipality !== location.place
          ? ` (${location.municipality})`
          : null}
        , {location.state}
      </p>
      <a
        href={`https://www.openstreetmap.org/#map=13/${lat}/${lon}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
      >
        In OpenStreetMap ansehen <ExternalLink className="size-3.5" aria-hidden="true" />
        <span className="sr-only">(öffnet in neuem Tab)</span>
      </a>
    </Card>
  );
}
