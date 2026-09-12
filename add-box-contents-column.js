require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addBoxContentsColumn() {
  try {

    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS box_contents TEXT DEFAULT '';
    `);

    console.log(
      '✅ Box contents column added successfully!'
    );

  } catch (error) {

    console.error(
      '❌ Error adding box contents column:'
    );

    console.error(error);

  } finally {

    await pool.end();

  }
}

addBoxContentsColumn();