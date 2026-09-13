require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function createCollectionsTable() {
  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log(
      '✅ Collections table created successfully!'
    );

  } catch (error) {

    console.error(
      '❌ Error creating collections table:'
    );

    console.error(error);

  } finally {

    await pool.end();

  }
}

createCollectionsTable();