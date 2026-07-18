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

  const modelResult = await pool.query(
    "SELECT COUNT(*) AS count FROM model_applications WHERE status = 'pending'"
  );
  const pendingModelApplications = parseInt(modelResult.rows[0].count, 10);

  const modelsCountResult = await pool.query(
    "SELECT COUNT(*) AS count FROM model_applications WHERE status = 'accepted'"
  );
  const totalModels = parseInt(modelsCountResult.rows[0].count, 10);

  res.json({
    totalCustomers: totalCustomers,
    totalModels: totalModels,
    todaysAppointments: todaysAppointments,
    pendingOrders: 0,
    totalProducts: 0,
    pendingModelApplications: pendingModelApplications
  });
});

app.get('/admin/recent-activity', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const usersResult = await pool.query(
    'SELECT name, created_at FROM users WHERE is_admin = 0 ORDER BY created_at DESC LIMIT 5'
  );
  const userActivity = usersResult.rows.map(function(user) {
    return {
      message: user.name + ' created an account',
      time: user.created_at
    };
  });

  const modelAppResult = await pool.query(`
    SELECT users.name AS applicant_name, model_applications.created_at
    FROM model_applications
    JOIN users ON model_applications.user_id = users.id
    ORDER BY model_applications.created_at DESC
    LIMIT 5
  `);
  const modelAppActivity = modelAppResult.rows.map(function(app) {
    return {
      message: app.applicant_name + ' submitted a model application',
      time: app.created_at
    };
  });

  const apptResult = await pool.query(`
    SELECT users.name AS customer_name, appointments.service, appointments.created_at
    FROM appointments
    JOIN users ON appointments.user_id = users.id
    ORDER BY appointments.created_at DESC
    LIMIT 5
  `);
  const apptActivity = apptResult.rows.map(function(appt) {
    return {
      message: appt.customer_name + ' booked ' + appt.service,
      time: appt.created_at
    };
  });

  const modelBookingResult = await pool.query(`
    SELECT users.name AS model_name, model_bookings.booking_date, model_bookings.booking_time, model_bookings.created_at
    FROM model_bookings
    JOIN users ON model_bookings.user_id = users.id
    ORDER BY model_bookings.created_at DESC
    LIMIT 5
  `);
  const modelBookingActivity = modelBookingResult.rows.map(function(booking) {
    return {
      message: booking.model_name + ' booked a modelling session for ' + booking.booking_date + ' at ' + booking.booking_time,
      time: booking.created_at
    };
  });

  const apptRescheduleResult = await pool.query(`
    SELECT users.name AS customer_name, appointments.updated_at
    FROM appointments
    JOIN users ON appointments.user_id = users.id
    WHERE appointments.status = 'rescheduled'
    ORDER BY appointments.updated_at DESC
    LIMIT 5
  `);
  const apptRescheduleActivity = apptRescheduleResult.rows.map(function(appt) {
    return {
      message: appt.customer_name + ' rescheduled their appointment',
      time: appt.updated_at
    };
  });

  const modelRescheduleResult = await pool.query(`
    SELECT users.name AS model_name, model_bookings.updated_at
    FROM model_bookings
    JOIN users ON model_bookings.user_id = users.id
    WHERE model_bookings.status = 'rescheduled'
    ORDER BY model_bookings.updated_at DESC
    LIMIT 5
  `);
  const modelRescheduleActivity = modelRescheduleResult.rows.map(function(b) {
    return {
      message: b.model_name + ' rescheduled their modelling session',
      time: b.updated_at
    };
  });

  const combined = userActivity
    .concat(modelAppActivity)
    .concat(apptActivity)
    .concat(modelBookingActivity)
    .concat(apptRescheduleActivity)
    .concat(modelRescheduleActivity);

  combined.sort(function(a, b) {
    return new Date(b.time) - new Date(a.time);
  });

  res.json({ activity: combined.slice(0, 8) });
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
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, req.params.id]);

  res.json({ success: true });
});

app.patch('/appointments/:id/reschedule', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const { date, time, reason } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required.' });
  }

  const apptResult = await pool.query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  const appointment = apptResult.rows[0];

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found.' });
  }

  const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  const isAdmin = userResult.rows[0] && userResult.rows[0].is_admin;

  if (appointment.user_id !== userId && !isAdmin) {
    return res.status(403).json({ error: 'You can only reschedule your own appointments.' });
  }

  await pool.query(
    'UPDATE appointments SET appointment_date = $1, appointment_time = $2, status = $3, updated_at = NOW(), reschedule_reason = $4 WHERE id = $5',
    [date, time, 'rescheduled', reason || '', req.params.id]
  );

  res.json({ success: true });
});

app.post('/model-applications', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'You must be logged in to apply.' });
  }

  const { age, phone, socialHandle, interest, availability, about, portfolioLink } = req.body;

  if (!age || !interest) {
    return res.status(400).json({ error: 'Age and area of interest are required.' });
  }

  const existingResult = await pool.query(
    'SELECT id FROM model_applications WHERE user_id = $1',
    [userId]
  );

  if (existingResult.rows[0]) {
    return res.status(409).json({ error: 'You have already submitted an application.' });
  }

  const result = await pool.query(
    `INSERT INTO model_applications (user_id, age, phone, social_handle, interest, availability, about, portfolio_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, age, phone || '', socialHandle || '', interest, availability || '', about || '', portfolioLink || '']
  );

  res.json({ success: true, applicationId: result.rows[0].id });
});

app.get('/admin/model-applications', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(`
    SELECT model_applications.*, users.name AS customer_name, users.email AS customer_email
    FROM model_applications
    JOIN users ON model_applications.user_id = users.id
    ORDER BY created_at DESC
  `);

  res.json({ applications: result.rows });
});

app.patch('/admin/model-applications/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { status } = req.body;
  const validStatuses = ['pending', 'accepted', 'rejected'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  await pool.query('UPDATE model_applications SET status = $1 WHERE id = $2', [status, req.params.id]);

  res.json({ success: true });
});

app.get('/my-model-status', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const result = await pool.query(
    'SELECT status FROM model_applications WHERE user_id = $1',
    [userId]
  );

  const application = result.rows[0];
  res.json({ status: application ? application.status : 'none' });
});

app.post('/admin/model-bookings', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { userId, date, time, notes } = req.body;

  if (!userId || !date || !time) {
    return res.status(400).json({ error: 'Model, date, and time are required.' });
  }

  const result = await pool.query(
    'INSERT INTO model_bookings (user_id, booking_date, booking_time, notes, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, date, time, notes || '', 'confirmed']
  );

  await pool.query(
    'DELETE FROM model_availability WHERE user_id = $1 AND available_date = $2',
    [userId, date]
  );

  res.json({ success: true, bookingId: result.rows[0].id });
});

app.get('/my-model-bookings', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const result = await pool.query(
    'SELECT * FROM model_bookings WHERE user_id = $1 ORDER BY booking_date DESC',
    [userId]
  );

  res.json({ bookings: result.rows });
});

app.get('/admin/model-bookings', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(`
    SELECT model_bookings.*, users.name AS model_name, users.email AS model_email, model_applications.phone AS model_phone
    FROM model_bookings
    JOIN users ON model_bookings.user_id = users.id
    LEFT JOIN model_applications ON model_applications.user_id = model_bookings.user_id
    ORDER BY model_bookings.booking_date DESC
  `);

  res.json({ bookings: result.rows });
});

app.patch('/admin/model-bookings/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  await pool.query('UPDATE model_bookings SET status = $1 WHERE id = $2', [status, req.params.id]);

  res.json({ success: true });
});

app.patch('/admin/model-bookings/:id/reschedule', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { date, time, reason } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required.' });
  }

  await pool.query(
    'UPDATE model_bookings SET booking_date = $1, booking_time = $2, status = $3, updated_at = NOW(), reschedule_reason = $4 WHERE id = $5',
    [date, time, 'rescheduled', reason || '', req.params.id]
  );

  res.json({ success: true });
});

function hoursForDay(weekday) {
  if (weekday === 0) return [];
  if (weekday === 6) return [12, 13, 14, 15, 16];
  return [10, 11, 12, 13, 14, 15, 16];
}

function parseTimeToHour(timeLabel) {
  const match = timeLabel.match(/(\d+):00 (AM|PM)/);
  let hour = parseInt(match[1], 10);
  if (match[2] === 'PM' && hour !== 12) hour += 12;
  if (match[2] === 'AM' && hour === 12) hour = 0;
  return hour;
}

app.get('/availability', async function(req, res) {
  const { date, bookingType } = req.query;

  if (!date || !bookingType) {
    return res.status(400).json({ error: 'Date and booking type are required.' });
  }

  const overrideResult = await pool.query(
    'SELECT override_type FROM availability_overrides WHERE override_date = $1',
    [date]
  );
  const override = overrideResult.rows[0];

  if (override && override.override_type === 'closed') {
    return res.json({ closed: true, slots: [] });
  }

  if (override && override.override_type === 'models_only' && bookingType === 'customer') {
    return res.json({ closed: true, slots: [] });
  }

  const weekday = new Date(date + 'T00:00:00').getDay();
  const allHours = hoursForDay(weekday);

  const apptResult = await pool.query(
    'SELECT appointment_time FROM appointments WHERE appointment_date = $1 AND status != $2',
    [date, 'cancelled']
  );
  const modelResult = await pool.query(
    'SELECT booking_time FROM model_bookings WHERE booking_date = $1 AND status != $2',
    [date, 'cancelled']
  );

  const bookedHours = [];
  apptResult.rows.forEach(function(row) {
    bookedHours.push(parseTimeToHour(row.appointment_time));
  });
  modelResult.rows.forEach(function(row) {
    bookedHours.push(parseTimeToHour(row.booking_time));
  });

  const slots = allHours.map(function(hour) {
    const isBlocked = bookedHours.some(function(bookedHour) {
      return Math.abs(bookedHour - hour) < 4;
    });
    return { hour: hour, available: !isBlocked };
  });

  res.json({ closed: false, slots: slots });
});

app.get('/admin/availability-overrides', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(
    'SELECT * FROM availability_overrides ORDER BY override_date ASC'
  );

  res.json({ overrides: result.rows });
});

app.post('/admin/availability-overrides', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { date, type } = req.body;
  const validTypes = ['closed', 'models_only'];

  if (!date || !validTypes.includes(type)) {
    return res.status(400).json({ error: 'A valid date and type are required.' });
  }

  await pool.query(
    `INSERT INTO availability_overrides (override_date, override_type)
     VALUES ($1, $2)
     ON CONFLICT (override_date) DO UPDATE SET override_type = $2`,
    [date, type]
  );

  res.json({ success: true });
});

app.delete('/admin/availability-overrides/:date', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  await pool.query('DELETE FROM availability_overrides WHERE override_date = $1', [req.params.date]);

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

app.post('/model-availability', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const statusResult = await pool.query('SELECT status FROM model_applications WHERE user_id = $1', [userId]);
  const application = statusResult.rows[0];
  if (!application || application.status !== 'accepted') {
    return res.status(403).json({ error: 'Only approved models can set availability.' });
  }

  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'At least one date is required.' });
  }

  for (const date of dates) {
    await pool.query(
      'INSERT INTO model_availability (user_id, available_date) VALUES ($1, $2) ON CONFLICT (user_id, available_date) DO NOTHING',
      [userId, date]
    );
  }

  res.json({ success: true });
});

app.get('/my-availability', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const result = await pool.query(
    'SELECT * FROM model_availability WHERE user_id = $1 ORDER BY available_date ASC',
    [userId]
  );

  res.json({ availability: result.rows });
});

app.delete('/model-availability/:date', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  await pool.query(
    'DELETE FROM model_availability WHERE user_id = $1 AND available_date = $2',
    [userId, req.params.date]
  );

  res.json({ success: true });
});

app.get('/admin/model-availability', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query(`
    SELECT model_availability.*, users.name AS model_name, users.email AS model_email
    FROM model_availability
    JOIN users ON model_availability.user_id = users.id
    ORDER BY available_date ASC
  `);

  res.json({ availability: result.rows });
});

app.patch('/appointments/:id/cancel', async function(req, res) {
  const userId = await getUserIdFromToken(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const apptResult = await pool.query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  const appointment = apptResult.rows[0];

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found.' });
  }

  const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  const isAdmin = userResult.rows[0] && userResult.rows[0].is_admin;

  if (appointment.user_id !== userId && !isAdmin) {
    return res.status(403).json({ error: 'You can only cancel your own appointments.' });
  }

  await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['cancelled', req.params.id]);

  res.json({ success: true });
});

app.get('/admin/products', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
  res.json({ products: result.rows });
});

app.post('/admin/products', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { name, description, price, imageUrl, category, stockQuantity } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required.' });
  }

  const result = await pool.query(
    `INSERT INTO products (name, description, price, image_url, category, stock_quantity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, description || '', Math.round(price * 100), imageUrl || '', category || '', stockQuantity || 0]
  );

  res.json({ success: true, productId: result.rows[0].id });
});

app.patch('/admin/products/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const { name, description, price, imageUrl, category, stockQuantity, isActive } = req.body;

  await pool.query(
    `UPDATE products
     SET name = $1, description = $2, price = $3, image_url = $4, category = $5, stock_quantity = $6, is_active = $7
     WHERE id = $8`,
    [name, description || '', Math.round(price * 100), imageUrl || '', category || '', stockQuantity || 0, isActive ? 1 : 0, req.params.id]
  );

  res.json({ success: true });
});

app.delete('/admin/products/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});