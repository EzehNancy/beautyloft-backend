require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addCategoriesColumn() {
  try {

    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]';
    `);

    console.log(
      '✅ Categories column added successfully!'
    );

  } catch (error) {

    console.error(
      '❌ Error adding categories column:'
    );

    console.error(error);

  } finally {

    await pool.end();

  }
}

addCategoriesColumn();