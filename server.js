require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = ['http://127.0.0.1:5500', 'https://beautyloft.vercel.app'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

async function getUserIdFromToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  const result = await pool.query('SELECT user_id FROM auth_tokens WHERE token = $1', [token]);
  const row = result.rows[0];
  return row ? row.user_id : null;
}

async function requireAdmin(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not logged in.' });
    return null;
  }
  const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  const currentUser = result.rows[0];
  if (!currentUser || !currentUser.is_admin) {
    res.status(403).json({ error: 'Admins only.' });
    return null;
  }
  return userId;
}

app.get('/', (req, res) => {
  res.send('Hello from The BeautyLoft backend!');
});

app.post('/book', (req, res) => {
  const booking = req.body;
  console.log('New booking received:', booking);
  res.json({ success: true, message: 'Booking received!' });
});

app.post('/signup', async function(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const existingResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const existing = existingResult.rows[0];
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const insertResult = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [name, email, passwordHash]
  );

  res.json({ success: true, userId: insertResult.rows[0].id });
});

app.post('/login', async function(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = userResult.rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO auth_tokens (token, user_id) VALUES ($1, $2)', [token, user.id]);

  res.json({
    success: true,
    token: token,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get('/me', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const result = await pool.query('SELECT id, name, email, is_admin FROM users WHERE id = $1', [userId]);
  res.json({ user: result.rows[0] });
});

app.post('/logout', async function(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    await pool.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
  }
  res.json({ success: true });
});

app.get('/admin/stats', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const customersResult = await pool.query('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0');
  const totalCustomers = parseInt(customersResult.rows[0].count, 10);

  const today = new Date().toISOString().split('T')[0];
  const apptResult = await pool.query(
    'SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = $1',
    [today]
  );
  const todaysAppointments = parseInt(apptResult.rows[0].count, 10);

  res.json({
    totalCustomers: totalCustomers,
    todaysAppointments: todaysAppointments,
    pendingOrders: 0,
    totalProducts: 0,
    pendingModelApplications: 0
  });
});

app.get('/admin/recent-activity', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(
    'SELECT name, created_at FROM users WHERE is_admin = 0 ORDER BY created_at DESC LIMIT 5'
  );

  const activity = result.rows.map(function(user) {
    return {
      message: user.name + ' created an account',
      time: user.created_at
    };
  });

  res.json({ activity: activity });
});

app.post('/appointments', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'You must be logged in to book.' });
  }

  const { service, date, time, notes, bookingRef } = req.body;

  if (!service || !date || !time) {
    return res.status(400).json({ error: 'Service, date, and time are required.' });
  }

  const result = await pool.query(
    'INSERT INTO appointments (user_id, service, appointment_date, appointment_time, notes, booking_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [userId, service, date, time, notes || '', bookingRef]
  );

  res.json({ success: true, appointmentId: result.rows[0].id });
});

app.get('/my-appointments', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const result = await pool.query(
    'SELECT * FROM appointments WHERE user_id = $1 ORDER BY appointment_date DESC',
    [userId]
  );

  res.json({ appointments: result.rows });
});

app.get('/admin/appointments', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(`
    SELECT appointments.*, users.name AS customer_name, users.email AS customer_email
    FROM appointments
    JOIN users ON appointments.user_id = users.id
    ORDER BY appointment_date DESC
  `);

  res.json({ appointments: result.rows });
});

app.patch('/admin/appointments/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, req.params.id]);

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

app.post('/setup-admin', function(req, res) {
  const { email, key } = req.body;

  if (key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid key.' });
  }

  const result = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'No user found with that email.' });
  }

  res.json({ success: true, message: email + ' is now an admin.' });
});

