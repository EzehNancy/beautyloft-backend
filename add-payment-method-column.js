require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


async function addPaymentMethodColumn() {

  try {

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS
      payment_method TEXT;
    `);

    console.log(
      'payment_method column added successfully.'
    );

  } catch (error) {

    console.error(
      'ERROR ADDING PAYMENT METHOD:',
      error
    );

  } finally {

    await pool.end();

  }

}


addPaymentMethodColumn();