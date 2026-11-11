import { describe, expect, it } from 'vitest';
import { arcKeyframes, rubberBand, swipeTarget } from './motion';

describe('rubberBand', () => {
  it('gibt immer weniger nach, je weiter gezogen wird, und nie mehr als der Finger', () => {
    const width = 360;
    const small = rubberBand(40, width);
    const large = rubberBand(200, width);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(40);
    expect(large).toBeGreaterThan(small);
    // Der Zuwachs nimmt ab: die zweiten 160 px bringen weniger als viermal die ersten 40 px
    expect(large - small).toBeLessThan(small * 4);
    expect(rubberBand(10_000, width)).toBeLessThan(width);
  });

  it('bleibt ohne Zug bei null', () => {
    expect(rubberBand(0, 360)).toBe(0);
    expect(rubberBand(-5, 360)).toBe(0);
    expect(rubberBand(50, 0)).toBe(0);
  });
});

describe('swipeTarget', () => {
  it('wechselt bei mehr als einem Viertel der Breite', () => {
    expect(swipeTarget(-120, 600, 360)).toBe(1);
    expect(swipeTarget(120, 600, 360)).toBe(-1);
  });

  it('wechselt bei einem kurzen, schnellen Wisch', () => {
    expect(swipeTarget(-50, 100, 360)).toBe(1);
  });

  it('bleibt bei einem kurzen, langsamen Zug und bei einem Tippen', () => {
    expect(swipeTarget(-50, 600, 360)).toBe(0);
    expect(swipeTarget(3, 10, 360)).toBe(0);
  });
});

describe('arcKeyframes', () => {
  const point = (frame: Keyframe) => String(frame.translate).split(' ').map((v) => Number.parseFloat(v)) as [number, number];

  it('beginnt am alten Platz, endet am neuen und weicht dazwischen von der Geraden ab', () => {
    const frames = arcKeyframes(-200, 0);
    expect(point(frames[0]!)).toEqual([-200, 0]);
    expect(point(frames.at(-1)!)).toEqual([0, 0]);
    const middle = point(frames[Math.floor(frames.length / 2)]!);
    expect(middle[0]).toBeCloseTo(-100, 0);
    expect(Math.abs(middle[1])).toBeGreaterThan(5);
  });

  it('biegt bei entgegengesetzter Richtung zur anderen Seite – zwei Bilder tauschen aneinander vorbei', () => {
    const right = point(arcKeyframes(-200, 0)[3]!);
    const left = point(arcKeyframes(200, 0)[3]!);
    expect(Math.sign(right[1])).toBe(-Math.sign(left[1]));
  });

  it('bewegt nichts, wenn der Platz gleich bleibt', () => {
    expect(arcKeyframes(0, 0).every((frame) => frame.translate === '0px 0px')).toBe(true);
  });
});
