export interface FileStorage {
  saveTemporaryFile(temporaryPath: string): Promise<string>;
  pathFor(storageKey: string): string;
  remove(storageKey: string): Promise<void>;
}
