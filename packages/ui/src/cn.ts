import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Kombiniert Klassennamen und löst Tailwind-Konflikte auf (letzte Angabe gewinnt). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
