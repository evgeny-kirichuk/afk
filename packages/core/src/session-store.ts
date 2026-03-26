import { Database } from "bun:sqlite";
import type { ProviderName, StepName } from "./types.ts";

// ── Row Types ────────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string;
  provider_session_id: string | null;
  parent_session_id: string | null;
  track_id: string;
  task_id: string;
  step: string;
  provider: string;
  model: string;
  status: string;
  iteration: number;
  review_round: number;
  tokens_used: number;
  started_at: string;
  ended_at: string | null;
}

export interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  session_id: string;
  type: string;
  data: string;
  created_at: string;
}

export interface SessionTreeNode {
  session: SessionRow;
  children: SessionTreeNode[];
}

// ── Create Params ────────────────────────────────────────────────────────────

export interface CreateSessionParams {
  id: string;
  track_id: string;
  task_id: string;
  step: StepName;
  provider: ProviderName;
  model: string;
  parent_session_id?: string;
  iteration?: number;
  review_round?: number;
}

export interface SessionUpdates {
  provider_session_id: string | null;
  status: string;
  tokens_used: number;
  ended_at: string;
  iteration: number;
  review_round: number;
}

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider_session_id TEXT,
  parent_session_id TEXT,
  track_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  iteration INTEGER NOT NULL DEFAULT 1,
  review_round INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_track ON sessions(track_id);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
`;

// ── Session Store ────────────────────────────────────────────────────────────

export class SessionStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  createSession(params: CreateSessionParams): string {
    this.db
      .query(
        `INSERT INTO sessions (id, track_id, task_id, step, provider, model, parent_session_id, iteration, review_round, started_at)
       VALUES ($id, $track_id, $task_id, $step, $provider, $model, $parent_session_id, $iteration, $review_round, $started_at)`,
      )
      .run({
        $id: params.id,
        $track_id: params.track_id,
        $task_id: params.task_id,
        $step: params.step,
        $provider: params.provider,
        $model: params.model,
        $parent_session_id: params.parent_session_id ?? null,
        $iteration: params.iteration ?? 1,
        $review_round: params.review_round ?? 0,
        $started_at: new Date().toISOString(),
      });
    return params.id;
  }

  updateSession(id: string, updates: Partial<SessionUpdates>): void {
    const setClauses: string[] = [];
    const values: Record<string, unknown> = { $id: id };

    if (updates.provider_session_id !== undefined) {
      setClauses.push("provider_session_id = $provider_session_id");
      values.$provider_session_id = updates.provider_session_id;
    }
    if (updates.status !== undefined) {
      setClauses.push("status = $status");
      values.$status = updates.status;
    }
    if (updates.tokens_used !== undefined) {
      setClauses.push("tokens_used = $tokens_used");
      values.$tokens_used = updates.tokens_used;
    }
    if (updates.ended_at !== undefined) {
      setClauses.push("ended_at = $ended_at");
      values.$ended_at = updates.ended_at;
    }
    if (updates.iteration !== undefined) {
      setClauses.push("iteration = $iteration");
      values.$iteration = updates.iteration;
    }
    if (updates.review_round !== undefined) {
      setClauses.push("review_round = $review_round");
      values.$review_round = updates.review_round;
    }

    if (setClauses.length === 0) return;
    this.db.query(`UPDATE sessions SET ${setClauses.join(", ")} WHERE id = $id`).run(values);
  }

  getSession(id: string): SessionRow | null {
    return (this.db.query("SELECT * FROM sessions WHERE id = $id").get({ $id: id }) as SessionRow) ?? null;
  }

  getSessionsByTask(taskId: string): SessionRow[] {
    return this.db
      .query("SELECT * FROM sessions WHERE task_id = $task_id ORDER BY started_at")
      .all({ $task_id: taskId }) as SessionRow[];
  }

  getSessionsByTrack(trackId: string): SessionRow[] {
    return this.db
      .query("SELECT * FROM sessions WHERE track_id = $track_id ORDER BY started_at")
      .all({ $track_id: trackId }) as SessionRow[];
  }

  getChildSessions(parentId: string): SessionRow[] {
    return this.db
      .query("SELECT * FROM sessions WHERE parent_session_id = $parent_id ORDER BY started_at")
      .all({ $parent_id: parentId }) as SessionRow[];
  }

  getActiveSession(trackId: string): SessionRow | null {
    return (
      (this.db
        .query("SELECT * FROM sessions WHERE track_id = $track_id AND status = 'running' ORDER BY started_at DESC LIMIT 1")
        .get({ $track_id: trackId }) as SessionRow) ?? null
    );
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  addMessage(sessionId: string, role: string, content: string): void {
    this.db
      .query(
        `INSERT INTO messages (session_id, role, content, created_at)
       VALUES ($session_id, $role, $content, $created_at)`,
      )
      .run({
        $session_id: sessionId,
        $role: role,
        $content: content,
        $created_at: new Date().toISOString(),
      });
  }

  getMessages(sessionId: string): MessageRow[] {
    return this.db
      .query("SELECT * FROM messages WHERE session_id = $session_id ORDER BY created_at, id")
      .all({ $session_id: sessionId }) as MessageRow[];
  }

  getPendingHumanMessages(sessionId: string): MessageRow[] {
    return this.db
      .query("SELECT * FROM messages WHERE session_id = $session_id AND role = 'human' ORDER BY created_at, id")
      .all({ $session_id: sessionId }) as MessageRow[];
  }

  // ── Events ───────────────────────────────────────────────────────────────

  addEvent(sessionId: string, type: string, data: unknown): void {
    this.db
      .query(
        `INSERT INTO events (session_id, type, data, created_at)
       VALUES ($session_id, $type, $data, $created_at)`,
      )
      .run({
        $session_id: sessionId,
        $type: type,
        $data: JSON.stringify(data),
        $created_at: new Date().toISOString(),
      });
  }

  getEvents(sessionId: string, since?: string): EventRow[] {
    if (since) {
      return this.db
        .query("SELECT * FROM events WHERE session_id = $session_id AND created_at > $since ORDER BY created_at, id")
        .all({ $session_id: sessionId, $since: since }) as EventRow[];
    }
    return this.db
      .query("SELECT * FROM events WHERE session_id = $session_id ORDER BY created_at, id")
      .all({ $session_id: sessionId }) as EventRow[];
  }

  // ── Session Tree ─────────────────────────────────────────────────────────

  getSessionTree(rootSessionId: string): SessionTreeNode | null {
    const root = this.getSession(rootSessionId);
    if (!root) return null;

    const buildNode = (session: SessionRow): SessionTreeNode => {
      const children = this.getChildSessions(session.id);
      return {
        session,
        children: children.map(buildNode),
      };
    };

    return buildNode(root);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
