require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addDisplayDetailsColumns() {
  try {

    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS display_size TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS display_shape TEXT DEFAULT '';
    `);

    console.log(
      '✅ Display size and shape columns added successfully!'
    );

  } catch (error) {

    console.error(
      '❌ Error adding display columns:'
    );

    console.error(error);

  } finally {

    await pool.end();

  }
}

addDisplayDetailsColumns();