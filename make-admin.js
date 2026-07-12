const pool = require('./database.js');

const email = process.argv[2];

if (!email) {
  console.log('Usage: node make-admin.js youremail@example.com');
  process.exit(1);
}

async function run() {
  const result = await pool.query('UPDATE users SET is_admin = 1 WHERE email = $1', [email]);

  if (result.rowCount === 0) {
    console.log('No user found with that email.');
  } else {
    console.log(email + ' is now an admin.');
  }

  process.exit();
}

run();