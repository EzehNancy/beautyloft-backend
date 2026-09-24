require('dotenv').config();

const { Pool } = require('pg');


const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


async function migrate() {

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (

        id SERIAL PRIMARY KEY,

        user_id INTEGER
          REFERENCES users(id)
          ON DELETE SET NULL,

        order_ref TEXT
          UNIQUE
          NOT NULL,

        first_name TEXT NOT NULL,

        last_name TEXT NOT NULL,

        email TEXT NOT NULL,

        phone TEXT NOT NULL,

        delivery_address TEXT NOT NULL,

        city TEXT NOT NULL,

        state TEXT NOT NULL,

        delivery_instructions TEXT,

        subtotal INTEGER NOT NULL,

        delivery_fee INTEGER
          NOT NULL
          DEFAULT 0,

        total INTEGER NOT NULL,

        payment_status TEXT
          NOT NULL
          DEFAULT 'pending',

        order_status TEXT
          NOT NULL
          DEFAULT 'pending',

        payment_reference TEXT,

        created_at TIMESTAMP
          DEFAULT CURRENT_TIMESTAMP

      );
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (

        id SERIAL PRIMARY KEY,

        order_id INTEGER
          NOT NULL
          REFERENCES orders(id)
          ON DELETE CASCADE,

        product_id INTEGER
          REFERENCES products(id)
          ON DELETE SET NULL,

        product_name TEXT NOT NULL,

        unit_price INTEGER NOT NULL,

        quantity INTEGER NOT NULL,

        size TEXT,

        nail_type TEXT,

        shape TEXT,

        finish TEXT,

        length TEXT,

        image_url TEXT

      );
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_measurements (

        id SERIAL PRIMARY KEY,

        order_id INTEGER
          NOT NULL
          UNIQUE
          REFERENCES orders(id)
          ON DELETE CASCADE,

        left_thumb NUMERIC(5,1),

        left_index NUMERIC(5,1),

        left_middle NUMERIC(5,1),

        left_ring NUMERIC(5,1),

        left_pinky NUMERIC(5,1),

        right_thumb NUMERIC(5,1),

        right_index NUMERIC(5,1),

        right_middle NUMERIC(5,1),

        right_ring NUMERIC(5,1),

        right_pinky NUMERIC(5,1)

      );
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_measurements (

        id SERIAL PRIMARY KEY,

        user_id INTEGER
          UNIQUE
          NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        left_thumb NUMERIC(5,1),

        left_index NUMERIC(5,1),

        left_middle NUMERIC(5,1),

        left_ring NUMERIC(5,1),

        left_pinky NUMERIC(5,1),

        right_thumb NUMERIC(5,1),

        right_index NUMERIC(5,1),

        right_middle NUMERIC(5,1),

        right_ring NUMERIC(5,1),

        right_pinky NUMERIC(5,1),

        updated_at TIMESTAMP
          DEFAULT CURRENT_TIMESTAMP

      );
    `);


    console.log(
      'Checkout tables created successfully.'
    );

  } catch (error) {

    console.error(
      'Migration failed:',
      error
    );

  } finally {

    await pool.end();

  }

}


migrate();