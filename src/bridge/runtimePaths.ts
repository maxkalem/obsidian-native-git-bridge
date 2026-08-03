import {
  CANCEL_DIR,
  DONE_DIR,
  PLUGIN_ID,
  REQUESTS_DIR,
  RESULTS_DIR,
  RUNTIME_DIR_NAME,
} from "../constants";

/** Vault-relative runtime paths. configDir is app.vault.configDir (usually ".obsidian"). */
export class RuntimePaths {
  readonly root: string;

  constructor(configDir: string) {
    this.root = `${configDir}/plugins/${PLUGIN_ID}/${RUNTIME_DIR_NAME}`;
  }

  get requestsDir(): string {
    return `${this.root}/${REQUESTS_DIR}`;
  }
  get resultsDir(): string {
    return `${this.root}/${RESULTS_DIR}`;
  }
  get cancelDir(): string {
    return `${this.root}/${CANCEL_DIR}`;
  }
  get doneDir(): string {
    return `${this.root}/${DONE_DIR}`;
  }
  requestFile(id: string): string {
    return `${this.requestsDir}/${id}.json`;
  }
  resultFile(id: string): string {
    return `${this.resultsDir}/${id}.json`;
  }
  cancelFile(id: string): string {
    return `${this.cancelDir}/${id}`;
  }
  all(): string[] {
    return [this.root, this.requestsDir, this.resultsDir, this.cancelDir, this.doneDir];
  }
}
