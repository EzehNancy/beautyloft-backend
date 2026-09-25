require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkOrders() {
  try {

    const result = await pool.query(`
      SELECT
        id,
        order_ref,
        payment_method,
        payment_status,
        order_status,
        admin_seen,
        created_at
      FROM orders
      ORDER BY id DESC
      LIMIT 5
    `);

    console.table(result.rows);

  } catch (error) {

    console.error(
      'CHECK ORDERS ERROR:',
      error
    );

  } finally {

    await pool.end();

  }
}

checkOrders();