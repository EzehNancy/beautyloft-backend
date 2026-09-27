require('dotenv').config();

const { Pool } = require('pg');


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {

  try {

    console.log(
      'Adding account detail columns...'
    );


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone TEXT;
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS address_first_name TEXT;
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS address_last_name TEXT;
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS delivery_address TEXT;
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS delivery_area TEXT;
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Lagos';
    `);


    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'Lagos';
    `);


    console.log(
      'Account detail columns added successfully.'
    );


  } catch (error) {

    console.error(
      'MIGRATION ERROR:',
      error
    );

  } finally {

    await pool.end();

  }

}


runMigration();