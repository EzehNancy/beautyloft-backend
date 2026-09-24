require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


async function addDeliveryAreaColumn() {

  try {

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS
      delivery_area TEXT;
    `);

    console.log(
      'delivery_area column added successfully.'
    );

  } catch (error) {

    console.error(
      'Error adding delivery_area column:',
      error
    );

  } finally {

    await pool.end();

  }

}


addDeliveryAreaColumn();