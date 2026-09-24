require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


async function updateOrderItemsTable() {

  try {

    await pool.query(`
      ALTER TABLE order_items

      ADD COLUMN IF NOT EXISTS
        unit_price INTEGER,

      ADD COLUMN IF NOT EXISTS
        size TEXT,

      ADD COLUMN IF NOT EXISTS
        nail_type TEXT,

      ADD COLUMN IF NOT EXISTS
        finish TEXT,

      ADD COLUMN IF NOT EXISTS
        image_url TEXT;
    `);

    console.log(
      'Order items table updated successfully.'
    );

  } catch (error) {

    console.error(
      'Error updating order_items table:',
      error
    );

  } finally {

    await pool.end();

  }

}


updateOrderItemsTable();