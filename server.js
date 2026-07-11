require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = ['http://127.0.0.1:5500', 'https://beautyloft.vercel.app'];

const SQLiteStore = require('connect-sqlite3')(session);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: '.' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'none',
    secure: true
  }
}));

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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
  ).run(name, email, passwordHash);

  res.json({ success: true, userId: result.lastInsertRowid });
});

app.post('/login', async function(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;

  res.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get('/me', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const user = db.prepare('SELECT id, name, email, is_admin FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: user });
});

app.post('/logout', function(req, res) {
  req.session.destroy(function() {
    res.json({ success: true });
  });
});

app.get('/admin/stats', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const currentUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: 'Admins only.' });
  }

  const totalCustomers = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0').get().count;

  const today = new Date().toISOString().split('T')[0];
  const todaysAppointments = db.prepare(
    'SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ?'
  ).get(today).count;

  res.json({
    totalCustomers: totalCustomers,
    todaysAppointments: todaysAppointments,
    pendingOrders: 0,
    totalProducts: 0,
    pendingModelApplications: 0
  });
});

app.get('/admin/recent-activity', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const currentUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: 'Admins only.' });
  }

  const recentUsers = db.prepare(
    'SELECT name, created_at FROM users WHERE is_admin = 0 ORDER BY created_at DESC LIMIT 5'
  ).all();

  const activity = recentUsers.map(function(user) {
    return {
      message: user.name + ' created an account',
      time: user.created_at
    };
  });

  res.json({ activity: activity });
});

app.post('/appointments', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'You must be logged in to book.' });
  }

  const { service, date, time, notes, bookingRef } = req.body;

  if (!service || !date || !time) {
    return res.status(400).json({ error: 'Service, date, and time are required.' });
  }

  const result = db.prepare(
    'INSERT INTO appointments (user_id, service, appointment_date, appointment_time, notes, booking_ref) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.session.userId, service, date, time, notes || '', bookingRef);

  res.json({ success: true, appointmentId: result.lastInsertRowid });
});

app.get('/my-appointments', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const appointments = db.prepare(
    'SELECT * FROM appointments WHERE user_id = ? ORDER BY appointment_date DESC'
  ).all(req.session.userId);

  res.json({ appointments: appointments });
});

app.get('/admin/appointments', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const currentUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: 'Admins only.' });
  }

  const appointments = db.prepare(`
    SELECT appointments.*, users.name AS customer_name, users.email AS customer_email
    FROM appointments
    JOIN users ON appointments.user_id = users.id
    ORDER BY appointment_date DESC
  `).all();

  res.json({ appointments: appointments });
});

app.patch('/admin/appointments/:id', function(req, res) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const currentUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: 'Admins only.' });
  }

  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, req.params.id);

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