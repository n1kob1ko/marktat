import { afterEach, describe, expect, it, vi } from 'vitest';
import { activePhoto, freshPhoto, placeholderBox, rememberPhoto, subscribePhoto } from './photo-transition';

describe('placeholderBox', () => {
  it('deckt bei 4:3-Fotos genau das eingepasste Bild', () => {
    expect(placeholderBox(1600, 1200)).toEqual({ width: 83.33, height: 100 });
  });

  it('bleibt bei Hochformat, Quadrat und Panorama innerhalb des Bilds', () => {
    // Hochformat 3:4 – das Bild ist 46,88 % des Rahmens breit, die Miniatur zeigt dessen Mitte
    expect(placeholderBox(1200, 1600)).toEqual({ width: 46.88, height: 56.25 });
    expect(placeholderBox(1000, 1000)).toEqual({ width: 62.5, height: 75 });
    // Panorama 3:1 – das Bild füllt die Breite, aber nur gut die halbe Höhe
    const wide = placeholderBox(3000, 1000);
    expect(wide.height).toBeCloseTo(53.33, 2);
    expect(wide.width).toBeCloseTo(44.44, 2);
  });

  it('nimmt ohne bekannte Maße 4:3 an', () => {
    expect(placeholderBox(0, 0)).toEqual(placeholderBox(4, 3));
  });
});

describe('rememberPhoto', () => {
  afterEach(() => vi.useRealTimers());

  it('merkt sich das angeklickte Foto kurz und gibt es danach wieder frei', () => {
    vi.useFakeTimers();
    const image = document.createElement('img');
    image.src = 'http://localhost/v1/images/abc/thumb';
    const listener = vi.fn();
    const unsubscribe = subscribePhoto(listener);

    rememberPhoto(image, 'data:image/webp;base64,AAAA');
    expect(activePhoto()).toBe(image);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(freshPhoto()).toMatchObject({ src: 'http://localhost/v1/images/abc/thumb', placeholder: 'data:image/webp;base64,AAAA' });

    vi.advanceTimersByTime(1600);
    expect(activePhoto()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    // Für die Detailseite gilt das Foto noch etwas länger als „eben angeklickt“ …
    expect(freshPhoto()).not.toBeNull();
    // … aber nicht mehr beim nächsten, späteren Seitenaufruf
    expect(freshPhoto(performance.now() + 10_000)).toBeNull();
    unsubscribe();
  });
});
