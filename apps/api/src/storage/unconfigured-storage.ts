import { StorageNotConfiguredError, type ObjectStorage } from './storage.types.js';

/** Platzhalter, wenn R2 nicht konfiguriert ist: Die API startet, nur Bildfunktionen melden 503. */
export class UnconfiguredStorage implements ObjectStorage {
  constructor(private readonly missing: string[]) {}

  private fail(): never {
    throw new StorageNotConfiguredError(this.missing);
  }

  presignUpload = async () => this.fail();
  presignDownload = async () => this.fail();
  head = async () => this.fail();
  getBytes = async () => this.fail();
  put = async () => this.fail();
  deleteMany = async () => this.fail();
}
