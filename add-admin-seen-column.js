require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


async function addAdminSeenColumn() {

  try {

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS admin_seen INTEGER DEFAULT 0;
    `);


    console.log(
      'admin_seen column added successfully.'
    );

  } catch (error) {

    console.error(
      'Error adding admin_seen column:',
      error
    );

  } finally {

    await pool.end();

  }

}


addAdminSeenColumn();