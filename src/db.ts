import { Database } from "bun:sqlite";

export function createDatabase(path?: string): Database {
  const db = new Database(path ?? ":memory:");

  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id            TEXT    NOT NULL,
      resource_type TEXT    NOT NULL,
      version_id    INTEGER NOT NULL DEFAULT 1,
      last_updated  TEXT    NOT NULL,
      is_deleted    INTEGER NOT NULL DEFAULT 0,
      data          TEXT    NOT NULL,
      PRIMARY KEY (id, resource_type)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS resources_history (
      id            TEXT    NOT NULL,
      resource_type TEXT    NOT NULL,
      version_id    INTEGER NOT NULL,
      last_updated  TEXT    NOT NULL,
      data          TEXT    NOT NULL,
      PRIMARY KEY (id, resource_type, version_id)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type_deleted ON resources(resource_type, is_deleted)");
  db.run("CREATE INDEX IF NOT EXISTS idx_resources_type_updated ON resources(resource_type, last_updated)");

  return db;
}
