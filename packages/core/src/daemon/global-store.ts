// ── Global Store ────────────────────────────────────────────────────────────
// SQLite DB at ~/.afk/afk.db — repo registry and daemon-wide state.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RepoRow {
  id: number;
  name: string;
  path: string;
  registered_at: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  registered_at TEXT NOT NULL
);
`;

export class GlobalStore {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
  }

  registerRepo(name: string, path: string): { repo: RepoRow; created: boolean } {
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO repos (name, path, registered_at)
         VALUES ($name, $path, $registered_at)`,
      )
      .run({
        $name: name,
        $path: path,
        $registered_at: new Date().toISOString(),
      });

    const repo = this.db
      .query("SELECT * FROM repos WHERE path = $path")
      .get({ $path: path }) as RepoRow;
    return { repo, created: result.changes > 0 };
  }

  getRepo(nameOrPath: string): RepoRow | null {
    return (
      (this.db
        .query("SELECT * FROM repos WHERE name = $v OR path = $v")
        .get({ $v: nameOrPath }) as RepoRow) ?? null
    );
  }

  listRepos(): RepoRow[] {
    return this.db.query("SELECT * FROM repos ORDER BY name").all() as RepoRow[];
  }

  removeRepo(nameOrPath: string): boolean {
    const result = this.db
      .query("DELETE FROM repos WHERE name = $v OR path = $v")
      .run({ $v: nameOrPath });
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

/** Default global DB path */
export function globalDbPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return `${home}/.afk/afk.db`;
}
