require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


async function updateOrdersTable() {

  try {

    await pool.query(`
      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
        first_name TEXT,

      ADD COLUMN IF NOT EXISTS
        last_name TEXT,

      ADD COLUMN IF NOT EXISTS
        email TEXT,

      ADD COLUMN IF NOT EXISTS
        phone TEXT,

      ADD COLUMN IF NOT EXISTS
        delivery_address TEXT,

      ADD COLUMN IF NOT EXISTS
        city TEXT,

      ADD COLUMN IF NOT EXISTS
        state TEXT,

      ADD COLUMN IF NOT EXISTS
        delivery_instructions TEXT,

      ADD COLUMN IF NOT EXISTS
        subtotal INTEGER,

      ADD COLUMN IF NOT EXISTS
        delivery_fee INTEGER DEFAULT 0,

      ADD COLUMN IF NOT EXISTS
        total INTEGER,

      ADD COLUMN IF NOT EXISTS
        order_status TEXT DEFAULT 'pending';
    `);

    console.log(
      'Orders table updated successfully.'
    );

  } catch (error) {

    console.error(
      'Error updating orders table:',
      error
    );

  } finally {

    await pool.end();

  }

}


updateOrdersTable();