require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


async function markOldOrdersSeen() {

  try {

    const result = await pool.query(`
      UPDATE orders
      SET admin_seen = 1
      WHERE admin_seen = 0;
    `);

    console.log(
      result.rowCount +
      ' old orders marked as attended.'
    );

  } catch (error) {

    console.error(
      'Error updating old orders:',
      error
    );

  } finally {

    await pool.end();

  }

}


markOldOrdersSeen();