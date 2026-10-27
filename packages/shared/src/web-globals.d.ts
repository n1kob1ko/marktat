/**
 * URL und URLSearchParams gibt es in Node (ab 10) und in allen Browsern. Das Paket bindet bewusst weder die
 * DOM- noch die Node-Typen ein; daher hier nur die verwendeten Teile.
 */
declare class URL {
  constructor(input: string, base?: string);
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly href: string;
}

declare class URLSearchParams {
  constructor(init?: Record<string, string> | string);
  delete(name: string): void;
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}
