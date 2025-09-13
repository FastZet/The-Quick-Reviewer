// src/core/storage.js — Unified storage layer (SQLite, PostgreSQL, or in-memory fallback)

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DATABASE_URI = process.env.DATABASE_URI || null;
const CACHE_EXPIRY_MS = 30 * 86400000; // 30 days

let mode = 'memory';           // 'memory' | 'sqlite' | 'postgres'
let mem = new Map();           // id -> { review: {review, verdict}, ts, type }
let sqlite = null;             // better-sqlite3 db handle
let pgClient = null;           // pg Client

// Detect driver from DATABASE_URI
function detectMode() {
  if (!DATABASE_URI) return 'memory';
  const uri = DATABASE_URI.toLowerCase();
  if (uri.startsWith('sqlite://')) return 'sqlite';
  if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) return 'postgres';
  // Unknown scheme -> safest is memory
  return 'memory';
}

// Ensure parent directory exists for SQLite file
async function ensureDirForSqliteFile(filePath) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
}

// Resolve sqlite:///... to filesystem path suitable for better-sqlite3
function sqliteFilePathFromUri(uri) {
  // Strip leading "sqlite://"
  let p = uri.replace(/^sqlite:\/\//i, '');
  // Resolve relative to process.cwd() (/app inside container)
  if (!path.isAbsolute(p)) p = path.resolve(process.cwd(), p);
  return p;
}

async function initStorage() {
  mode = detectMode();

  if (mode === 'sqlite') {
    // Lazy-require only when needed
    const BetterSqlite3 = require('better-sqlite3');

    const filePath = sqliteFilePathFromUri(DATABASE_URI);
    await ensureDirForSqliteFile(filePath);

    sqlite = new BetterSqlite3(filePath);
    sqlite.pragma('journal_mode = WAL');

    sqlite.prepare(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        review_json TEXT NOT NULL
      )
    `).run();
    return;
  }

  if (mode === 'postgres') {
    const { Client } = require('pg');
    pgClient = new Client({ connectionString: DATABASE_URI });
    await pgClient.connect();
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        ts BIGINT NOT NULL,
        review_json TEXT NOT NULL
      )
    `);
    return;
  }

  // memory fallback: nothing to init
}

// Shared expiry check
function isExpired(ts) {
  return (Date.now() - Number(ts)) > CACHE_EXPIRY_MS;
}

// Read single review by id
async function readReview(id) {
  if (mode === 'sqlite') {
    const row = sqlite.prepare(
      'SELECT review_json, ts, type FROM reviews WHERE id = ?'
    ).get(id);
    if (!row) return null;
    if (isExpired(row.ts)) return null;
    try {
      return JSON.parse(row.review_json);
    } catch {
      return null;
    }
  }

  if (mode === 'postgres') {
    const { rows } = await pgClient.query(
      'SELECT review_json, ts, type FROM reviews WHERE id = $1',
      [id]
    );
    if (!rows || rows.length === 0) return null;
    const row = rows;
    if (isExpired(row.ts)) return null;
    try {
      return JSON.parse(row.review_json);
    } catch {
      return null;
    }
  }

  // memory
  const entry = mem.get(id);
  if (!entry) return null;
  if (isExpired(entry.ts)) {
    mem.delete(id);
    return null;
  }
  return entry.review || null;
}

// Save or update review
async function saveReview(id, result, type) {
  const ts = Date.now();
  const reviewJson = JSON.stringify(result);

  if (mode === 'sqlite') {
    sqlite.prepare(`
      INSERT INTO reviews (id, type, ts, review_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,
        ts=excluded.ts,
        review_json=excluded.review_json
    `).run(id, type, ts, reviewJson);
    return;
  }

  if (mode === 'postgres') {
    await pgClient.query(`
      INSERT INTO reviews (id, type, ts, review_json)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        ts = EXCLUDED.ts,
        review_json = EXCLUDED.review_json
    `, [id, type, ts, reviewJson]);
    return;
  }

  // memory
  mem.set(id, { review: result, ts, type });
}

// List cached reviews (id, ts, type) with TTL applied
async function getAllCachedReviews() {
  const cutoff = Date.now() - CACHE_EXPIRY_MS;

  if (mode === 'sqlite') {
    const rows = sqlite.prepare(
      'SELECT id, type, ts FROM reviews WHERE ts >= ? ORDER BY ts DESC'
    ).all(cutoff);
    return rows.map(r => ({ id: r.id, ts: Number(r.ts), type: r.type }));
  }

  if (mode === 'postgres') {
    const { rows } = await pgClient.query(
      'SELECT id, type, ts FROM reviews WHERE ts >= $1 ORDER BY ts DESC',
      [cutoff]
    );
    return rows.map(r => ({ id: r.id, ts: Number(r.ts), type: r.type }));
  }

  // memory
  const out = [];
  for (const [key, entry] of mem.entries()) {
    if (!isExpired(entry.ts)) out.push({ id: key, ts: entry.ts, type: entry.type });
  }
  // Newest first
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

// Optional DB cleanup (TTL prune)
async function cleanupExpired() {
  const cutoff = Date.now() - CACHE_EXPIRY_MS;
  if (mode === 'sqlite') {
    sqlite.prepare('DELETE FROM reviews WHERE ts < ?').run(cutoff);
    return;
  }
  if (mode === 'postgres') {
    await pgClient.query('DELETE FROM reviews WHERE ts < $1', [cutoff]);
    return;
  }
  for (const [key, entry] of mem.entries()) {
    if (isExpired(entry.ts)) mem.delete(key);
  }
}

function isDbEnabled() {
  return mode === 'sqlite' || mode === 'postgres';
}

module.exports = {
  initStorage,
  readReview,
  saveReview,
  getAllCachedReviews,
  cleanupExpired,
  isDbEnabled,
};
