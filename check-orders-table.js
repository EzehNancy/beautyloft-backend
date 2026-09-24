require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


async function checkOrdersTable() {

  try {

const result =
  await pool.query(`
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_name = 'products'
    ORDER BY ordinal_position;
  `);

    console.table(result.rows);

  } catch (error) {

    console.error(
      'Error checking orders table:',
      error
    );

  } finally {

    await pool.end();

  }

}


checkOrdersTable();