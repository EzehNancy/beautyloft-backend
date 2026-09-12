require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addCollectionColumn() {
  try {
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS collection TEXT DEFAULT '';
    `);

    console.log('✅ Collection column added successfully!');
  } catch (error) {
    console.error('❌ Error adding collection column:');
    console.error(error);
  } finally {
    await pool.end();
  }
}

addCollectionColumn();