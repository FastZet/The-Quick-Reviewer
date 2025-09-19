/*
 * src/core/storage.js
 * Updated storage with schema migration fix
 */

'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DATABASE_URI = process.env.DATABASE_URI || null;
const CACHE_EXPIRY_MS = Number(process.env.CACHE_EXPIRY_MS || 30) * 86400000; // 30 days

let mode = 'memory'; // 'memory', 'sqlite', 'postgres'
let mem = new Map(); // id -> { review, ts, type }
let sqlite = null; // better-sqlite3 handle
let pgClient = null; // pg client

function detectMode() {
  if (!DATABASE_URI) return 'memory';
  const uri = DATABASE_URI.toLowerCase();
  if (uri.startsWith('sqlite')) return 'sqlite';
  if (uri.startsWith('postgres') || uri.startsWith('postgresql')) return 'postgres';
  return 'memory';
}

async function ensureDirForSqliteFile(filePath) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
}

function sqliteFilePathFromUri(uri) {
  // Strip leading 'sqlite'
  let p = uri.replace(/^sqlite:?\/?/i, '');
  
  // Resolve relative to process.cwd() inside container
  if (!path.isAbsolute(p)) {
    p = path.resolve(process.cwd(), p);
  }
  return p;
}

async function initStorage() {
  mode = detectMode();
  
  if (!DATABASE_URI) {
    console.log('[storage] No DATABASE_URI set defaulting to in-memory storage.');
    mode = 'memory';
    return;
  }
  
  console.log('[storage] DATABASE_URI detected:', DATABASE_URI);
  console.log('[storage] Selected backend:', mode);
  
  if (mode === 'sqlite') {
    try {
      const BetterSqlite3 = require('better-sqlite3');
      const filePath = sqliteFilePathFromUri(DATABASE_URI);
      
      await ensureDirForSqliteFile(filePath);
      sqlite = new BetterSqlite3(filePath);
      sqlite.pragma('journal_mode = WAL');
      
      // SCHEMA MIGRATION: Check if table exists and has correct columns
      try {
        // Try to query the existing table structure
        const tableInfo = sqlite.prepare("PRAGMA table_info(reviews)").all();
        const hasReviewJsonColumn = tableInfo.some(col => col.name === 'reviewjson');
        
        if (tableInfo.length === 0) {
          // Table doesn't exist, create it
          sqlite.prepare(`
            CREATE TABLE reviews (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              ts INTEGER NOT NULL,
              reviewjson TEXT NOT NULL
            )
          `).run();
          console.log('[storage] Created new reviews table');
        } else if (!hasReviewJsonColumn) {
          // Table exists but missing reviewjson column - migrate
          console.log('[storage] Migrating database schema...');
          
          // Check if old column exists (review, data, etc.)
          const hasReviewColumn = tableInfo.some(col => col.name === 'review');
          const hasDataColumn = tableInfo.some(col => col.name === 'data');
          
          if (hasReviewColumn) {
            // Migrate from 'review' to 'reviewjson'
            sqlite.prepare('ALTER TABLE reviews ADD COLUMN reviewjson TEXT').run();
            sqlite.prepare('UPDATE reviews SET reviewjson = review WHERE reviewjson IS NULL').run();
            console.log('[storage] Migrated data from review to reviewjson column');
          } else if (hasDataColumn) {
            // Migrate from 'data' to 'reviewjson'  
            sqlite.prepare('ALTER TABLE reviews ADD COLUMN reviewjson TEXT').run();
            sqlite.prepare('UPDATE reviews SET reviewjson = data WHERE reviewjson IS NULL').run();
            console.log('[storage] Migrated data from data to reviewjson column');
          } else {
            // Can't migrate, drop and recreate
            console.log('[storage] Cannot migrate schema, recreating table...');
            sqlite.prepare('DROP TABLE reviews').run();
            sqlite.prepare(`
              CREATE TABLE reviews (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                ts INTEGER NOT NULL,
                reviewjson TEXT NOT NULL
              )
            `).run();
          }
        }
        
        // Create index
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts)').run();
        
      } catch (migrationError) {
        console.warn('[storage] Schema migration failed, recreating table:', migrationError.message);
        // Drop and recreate table if migration fails
        try {
          sqlite.prepare('DROP TABLE IF EXISTS reviews').run();
        } catch (e) {}
        
        sqlite.prepare(`
          CREATE TABLE reviews (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            ts INTEGER NOT NULL,
            reviewjson TEXT NOT NULL
          )
        `).run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts)').run();
      }
      
      console.log('[storage] SQLite initialized at', filePath);
      return;
    } catch (err) {
      console.warn(`[storage] SQLite init failed, ${err?.message}. Falling back to memory.`);
      mode = 'memory';
      sqlite = null;
    }
  }
  
  if (mode === 'postgres') {
    try {
      const { Client } = require('pg');
      pgClient = new Client({ connectionString: DATABASE_URI });
      await pgClient.connect();
      
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          ts BIGINT NOT NULL,
          reviewjson TEXT NOT NULL
        )
      `);
      await pgClient.query('CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts)');
      console.log('[storage] PostgreSQL initialized');
      return;
    } catch (err) {
      console.warn(`[storage] Postgres init failed, ${err?.message}. Falling back to memory.`);
      mode = 'memory';
      pgClient = null;
    }
  }
  
  // In-memory
  mem = new Map();
  console.log('[storage] Using in-memory storage');
}

function isExpired(ts) {
  return (Date.now() - Number(ts)) > CACHE_EXPIRY_MS;
}

async function readReview(id) {
  let row;
  
  if (mode === 'sqlite') {
    row = sqlite.prepare('SELECT reviewjson, ts FROM reviews WHERE id = ?').get(id);
  } else if (mode === 'postgres') {
    const rows = await pgClient.query('SELECT reviewjson, ts FROM reviews WHERE id = $1', [id]);
    if (rows?.rows?.length > 0) {
      row = rows.rows[0];
    }
  } else {
    const entry = mem.get(id);
    if (!entry) return null;
    if (isExpired(entry.ts)) {
      mem.delete(id);
      return null;
    }
    return { review: entry.review, ts: entry.ts };
  }
  
  if (!row) return null;
  if (isExpired(row.ts)) {
    try {
      await deleteReview(id);
    } catch {}
    return null;
  }
  
  try {
    return { review: JSON.parse(row.reviewjson), ts: Number(row.ts) };
  } catch {
    return null;
  }
}

async function saveReview(id, result, type) {
  const ts = Date.now();
  const reviewJson = JSON.stringify(result);
  
  if (mode === 'sqlite') {
    sqlite.prepare(`
      INSERT INTO reviews (id, type, ts, reviewjson) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,
        ts=excluded.ts,
        reviewjson=excluded.reviewjson
    `).run(id, type, ts, reviewJson);
    return;
  }
  
  if (mode === 'postgres') {
    await pgClient.query(`
      INSERT INTO reviews (id, type, ts, reviewjson) VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        ts = EXCLUDED.ts,
        reviewjson = EXCLUDED.reviewjson
    `, [id, type, ts, reviewJson]);
    return;
  }
  
  mem.set(id, { review: result, ts, type });
}

async function getAllCachedReviews() {
  const cutoff = Date.now() - CACHE_EXPIRY_MS;
  
  if (mode === 'sqlite') {
    const rows = sqlite.prepare('SELECT id, type, ts FROM reviews WHERE ts > ? ORDER BY ts DESC').all(cutoff);
    return rows.map(r => ({ id: r.id, ts: Number(r.ts), type: r.type }));
  }
  
  if (mode === 'postgres') {
    const rows = await pgClient.query('SELECT id, type, ts FROM reviews WHERE ts > $1 ORDER BY ts DESC', [cutoff]);
    return rows.rows.map(r => ({ id: r.id, ts: Number(r.ts), type: r.type }));
  }
  
  const out = [];
  for (const [key, entry] of mem.entries()) {
    if (!isExpired(entry.ts)) {
      out.push({ id: key, ts: entry.ts, type: entry.type });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

async function getExpiredReviewIds() {
  const cutoff = Date.now() - CACHE_EXPIRY_MS;
  
  if (mode === 'sqlite') {
    return sqlite.prepare('SELECT id, type FROM reviews WHERE ts < ?').all(cutoff);
  }
  
  if (mode === 'postgres') {
    const rows = await pgClient.query('SELECT id, type FROM reviews WHERE ts < $1', [cutoff]);
    return rows.rows;
  }
  
  const expired = [];
  for (const [key, entry] of mem.entries()) {
    if (isExpired(entry.ts)) {
      expired.push({ id: key, type: entry.type });
    }
  }
  return expired;
}

async function deleteReview(id) {
  if (mode === 'sqlite') {
    sqlite.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    return;
  }
  
  if (mode === 'postgres') {
    await pgClient.query('DELETE FROM reviews WHERE id = $1', [id]);
    return;
  }
  
  mem.delete(id);
}

function isDbEnabled() {
  return mode === 'sqlite' || mode === 'postgres';
}

async function closeStorage() {
  try {
    if (mode === 'sqlite' && sqlite) {
      sqlite.close();
      sqlite = null;
    } else if (mode === 'postgres' && pgClient) {
      await pgClient.end();
      pgClient = null;
    }
  } catch (err) {
    console.warn(`[storage] closeStorage warning: ${err?.message || err}`);
  }
}

module.exports = {
  initStorage,
  readReview,
  saveReview,
  getAllCachedReviews,
  getExpiredReviewIds,
  deleteReview,
  isDbEnabled,
  closeStorage
};
