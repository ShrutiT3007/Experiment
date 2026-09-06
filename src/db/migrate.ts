/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

async function main() {
  if (!env.databaseUrl) {
    console.error('DATABASE_URL is not set; cannot run migrations.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, '../../database/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await mysql.createConnection({ uri: env.databaseUrl, multipleStatements: true });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`Applying migration: ${file}`);
      await connection.query(sql);
    }
    console.log('Migrations applied successfully.');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
