const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


async function updateCollectionsTable() {

  try {

    console.log(
      'Updating collections table...'
    );


    await pool.query(`
      ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS
      image_url TEXT DEFAULT '';
    `);


    await pool.query(`
      ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS
      is_featured INTEGER DEFAULT 0;
    `);


    await pool.query(`
      ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS
      is_active INTEGER DEFAULT 1;
    `);


    console.log(
      'Collections table updated successfully!'
    );


  } catch (error) {

    console.error(
      'Error updating collections table:',
      error
    );


  } finally {

    await pool.end();

  }

}


updateCollectionsTable();