require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addImagesColumn() {
  try {
    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';
    `);

    console.log('✅ Images column added successfully!');
  } catch (error) {
    console.error('❌ Error adding images column:');
    console.error(error);
  } finally {
    await pool.end();
  }
}

addImagesColumn();