require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');

const pool = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

const cloudinary = require('cloudinary').v2;
const multer = require('multer');

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

app.use(
  express.json({
    verify: function(req, res, buf) {
      req.rawBody = buf;
    }
  })
);

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

app.post('/signup', async function (req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'All fields are required.'
      });
    }

    // Normalize the email
    const normalizedEmail = email.trim().toLowerCase();

    // Check if the user already exists
    const existingResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error: 'An account with that email already exists.'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const insertResult = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [name.trim(), normalizedEmail, passwordHash]
    );

    return res.status(201).json({
      success: true,
      userId: insertResult.rows[0].id
    });

  } catch (error) {

    // PostgreSQL duplicate/unique constraint error
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'An account with that email already exists.'
      });
    }

    console.error('Signup error:', error);

    return res.status(500).json({
      error: 'Something went wrong while creating your account.'
    });
  }
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

  const productsResult = await pool.query(
    "SELECT COUNT(*) AS count FROM products WHERE is_active = 1"
  );
  const totalProducts = parseInt(productsResult.rows[0].count, 10);

  res.json({
    totalCustomers: totalCustomers,
    totalModels: totalModels,
    todaysAppointments: todaysAppointments,
    pendingOrders: 0,
    totalProducts: totalProducts,
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

  try {
    const {
  name,
  collection,
  categories,
  displaySize,
  displayShape,
  description,
  price,
  imageUrl,
  images,
  stockQuantity
} = req.body;

    if (!name || !price) {
      return res.status(400).json({
        error: 'Name and price are required.'
      });
    }

    const result = await pool.query(
  `INSERT INTO products
    (
      name,
      collection,
      categories,
      display_size,
      display_shape,
      description,
      price,
      image_url,
      images,
      stock_quantity
    )
   VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   RETURNING id`,
  [
    name,
    collection || '',
    JSON.stringify(categories || []),
    displaySize || '',
    displayShape || '',
    description || '',
    Math.round(price * 100),
    imageUrl || '',
    JSON.stringify(images || []),
    stockQuantity || 0
  ]
);

    res.json({
      success: true,
      productId: result.rows[0].id
    });

  } catch (error) {
    console.error('ADD PRODUCT ERROR:', error);

    res.status(500).json({
      error: 'Failed to add product.'
    });
  }
});

app.patch('/admin/products/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    const {
      name,
      collection,
      categories,
      displaySize,
      displayShape,
      description,
      price,
      imageUrl,
      images,
      stockQuantity,
      isActive
    } = req.body;

await pool.query(
  `UPDATE products
   SET
     name = $1,
     collection = $2,
     categories = $3,
     display_size = $4,
     display_shape = $5,
     description = $6,
     price = $7,
     image_url = $8,
     images = $9,
     stock_quantity = $10,
     is_active = $11
   WHERE id = $12`,
  [
    name,
    collection || '',
    JSON.stringify(categories || []),
    displaySize || '',
    displayShape || '',
    description || '',
    Math.round(price * 100),
    imageUrl || '',
    JSON.stringify(images || []),
    stockQuantity || 0,
    isActive ? 1 : 0,
    req.params.id
  ]
);

    res.json({
      success: true
    });

  } catch (error) {
    console.error('UPDATE PRODUCT ERROR:', error);

    res.status(500).json({
      error: 'Failed to update product.'
    });
  }
});

app.delete('/admin/products/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ================================
// COLLECTION ROUTES
// ================================

// Get all collections
app.get('/admin/collections', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    const result = await pool.query(
      `SELECT *
       FROM collections
       ORDER BY name ASC`
    );

    res.json({
      collections: result.rows
    });

  } catch (error) {
    console.error('GET COLLECTIONS ERROR:', error);

    res.status(500).json({
      error: 'Failed to load collections.'
    });
  }
});


// Add a collection
app.post('/admin/collections', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Collection name is required.'
      });
    }

    const result = await pool.query(
      `INSERT INTO collections (name)
       VALUES ($1)
       RETURNING *`,
      [name.trim()]
    );

    res.json({
      success: true,
      collection: result.rows[0]
    });

  } catch (error) {
    console.error('ADD COLLECTION ERROR:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        error: 'That collection already exists.'
      });
    }

    res.status(500).json({
      error: 'Failed to add collection.'
    });
  }
});


// Update a collection
app.patch(
  '/admin/collections/:id',
  async function(req, res) {

    if (!(await requireAdmin(req, res))) {
      return;
    }

    try {

      const {
        name,
        image_url,
        is_featured,
        is_active
      } = req.body;


      if (!name || !name.trim()) {

        return res.status(400).json({
          error:
            'Collection name is required.'
        });

      }


      const result =
        await pool.query(
          `
          UPDATE collections
          SET
            name = $1,
            image_url = $2,
            is_featured = $3,
            is_active = $4
          WHERE id = $5
          RETURNING *
          `,
          [
            name.trim(),
            image_url || '',
            is_featured ? 1 : 0,
            is_active ? 1 : 0,
            req.params.id
          ]
        );


      if (result.rows.length === 0) {

        return res.status(404).json({
          error:
            'Collection not found.'
        });

      }


      res.json({
        success: true,
        collection: result.rows[0]
      });


    } catch (error) {

      console.error(
        'UPDATE COLLECTION ERROR:',
        error
      );


      if (error.code === '23505') {

        return res.status(400).json({
          error:
            'That collection already exists.'
        });

      }


      res.status(500).json({
        error:
          'Failed to update collection.'
      });

    }

  }
);

// Delete a collection
app.delete('/admin/collections/:id', async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  try {
    await pool.query(
      `DELETE FROM collections
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({
      success: true
    });

  } catch (error) {
    console.error('DELETE COLLECTION ERROR:', error);

    res.status(500).json({
      error: 'Failed to delete collection.'
    });
  }
});


// Get public collections
app.get('/collections', async function(req, res) {

  try {

    const result =
      await pool.query(
        `
        SELECT
          id,
          name,
          image_url,
          is_featured,
          is_active
        FROM collections
        WHERE is_active = 1
        ORDER BY name ASC
        `
      );


    res.json({
      collections: result.rows
    });


  } catch (error) {

    console.error(
      'PUBLIC COLLECTIONS ERROR:',
      error
    );


    res.status(500).json({
      error:
        'Failed to load collections.'
    });

  }

});



cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/admin/upload-image', upload.single('image'), async function(req, res) {
  if (!(await requireAdmin(req, res))) return;

  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  try {
    const uploadResult = await new Promise(function(resolve, reject) {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'beautyloft-products' },
        function(error, result) {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ success: true, imageUrl: uploadResult.secure_url });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed.' });
  }
});

app.get('/products', async function(req, res) {
  const result = await pool.query(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC'
  );
  res.json({ products: result.rows });
});

app.get('/products/favourites', async function(req, res) {

  try {

    const result = await pool.query(`
      SELECT
        p.*,
        COALESCE(
          SUM(oi.quantity),
          0
        ) AS total_bought

      FROM products p

      JOIN order_items oi
        ON oi.product_id = p.id

      JOIN orders o
        ON o.id = oi.order_id

      WHERE
        p.is_active = 1
        AND o.payment_status = 'paid'

      GROUP BY p.id

      ORDER BY total_bought DESC

      LIMIT 5
    `);

    res.json({
      products: result.rows
    });

  } catch (error) {

    console.error(
      'Favourites error:',
      error
    );

    res.status(500).json({
      error: 'Failed to load favourites.'
    });

  }

});
app.get('/products/:id', async function(req, res) {
  const result = await pool.query('SELECT * FROM products WHERE id = $1 AND is_active = 1', [req.params.id]);
  const product = result.rows[0];

  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  res.json({ product: product });
});

function getSizePrice(size) {

  if (size === 'L') {
    return 1500 * 100;
  }

  if (size === 'XL') {
    return 2000 * 100;
  }

  if (size === 'XXL') {
    return 2500 * 100;
  }

  return 0;
}


function getNailTypePrice(nailType) {

  if (nailType === 'Builder Gel') {
    return 1000 * 100;
  }

  if (nailType === 'Polygel') {
    return 1500 * 100;
  }

  if (nailType === 'Acrylic') {
    return 2500 * 100;
  }

  return 0;
}

const LAGOS_DELIVERY_PRICES = {

  // Zone 1 — ₦2,500
  'Ikeja': 1 * 100,
  'Allen Avenue': 1 * 100,
  'Opebi': 1 * 100,
  'Alausa': 1 * 100,
  'Maryland': 1 * 100,
  'Anthony': 1 * 100,
  'Ogba': 1 * 100,
  'Ojodu': 1 * 100,
  'Berger': 1 * 100,
  'Omole': 1 * 100,
  'Magodo': 1 * 100,
  'GRA Ikeja': 1 * 100,
  'Computer Village': 1 * 100,

  // Zone 2 — ₦3,000
  'Yaba': 3000 * 100,
  'Sabo Yaba': 3000 * 100,
  'Akoka': 3000 * 100,
  'Onike': 3000 * 100,
  'Surulere': 3000 * 100,
  'Aguda': 3000 * 100,
  'Ijesha': 3000 * 100,
  'Mushin': 3000 * 100,
  'Palmgrove': 3000 * 100,
  'Onipanu': 3000 * 100,
  'Shomolu': 3000 * 100,
  'Bariga': 3000 * 100,
  'Gbagada': 3000 * 100,
  'Ifako-Gbagada': 3000 * 100,
  'Pedro': 3000 * 100,
  'Fadeyi': 3000 * 100,
  'Jibowu': 3000 * 100,
  'Ebute Metta': 3000 * 100,

  // Zone 3 — ₦3,000
  'Ketu': 3000 * 100,
  'Mile 12': 3000 * 100,
  'Ojota': 3000 * 100,
  'Kosofe': 3000 * 100,
  'Ikosi': 3000 * 100,
  'Alapere': 3000 * 100,
  'Ogudu': 3000 * 100,
  'Oworonshoki': 3000 * 100,
  'Ifako-Ijaiye': 3000 * 100,
  'Agege': 3000 * 100,
  'Dopemu': 3000 * 100,
  'Iju': 3000 * 100,
  'Fagba': 3000 * 100,
  'Abule Egba': 3000 * 100,

  // Zone 4 — ₦4,000
  'Victoria Island': 4000 * 100,
  'Oniru': 4000 * 100,
  'Ikoyi': 4000 * 100,
  'Banana Island': 4000 * 100,

  // Zone 5 — ₦4,000
  'Lekki Phase 1': 4000 * 100,
  'Ikate': 4000 * 100,
  'Osapa London': 4000 * 100,
  'Agungi': 4000 * 100,
  'Chevron': 4000 * 100,
  'Igbo Efon': 4000 * 100,
  'Jakande': 4000 * 100,
  'Chisco': 4000 * 100,
  'VGC': 4000 * 100,

  // Zone 6 — ₦4,500
  'Ajah': 4500 * 100,
  'Abraham Adesanya': 4500 * 100,
  'Sangotedo': 4500 * 100,
  'Badore': 4500 * 100,
  'Addo': 4500 * 100,
  'Langbasa': 4500 * 100,
  'Thomas Estate': 4500 * 100,
  'Ogombo': 4500 * 100,

  // Zone 7 — ₦3,500
  'Lagos Island': 3500 * 100,
  'Marina': 3500 * 100,
  'CMS': 3500 * 100,
  'Obalende': 3500 * 100,
  'Adeniji Adele': 3500 * 100,

  // Zone 8 — ₦4,000
  'Apapa': 4000 * 100,
  'GRA Apapa': 4000 * 100,
  'Ajegunle': 4000 * 100,
  'Ijora': 4000 * 100,
  'Orile': 4000 * 100,
  'Amukoko': 4000 * 100,

  // Zone 9 — ₦4,000
  'Festac': 4000 * 100,
  'Amuwo Odofin': 4000 * 100,
  'Satellite Town': 4000 * 100,
  'Mile 2': 4000 * 100,
  'Apple Junction': 4000 * 100,
  'Ago Palace': 4000 * 100,
  'Okota': 4000 * 100,
  'Isolo': 4000 * 100,
  'Oshodi': 4000 * 100,
  'Ajao Estate': 4000 * 100,

  // Zone 10 — ₦3,500
  'Egbeda': 3500 * 100,
  'Idimu': 3500 * 100,
  'Ikotun': 3500 * 100,
  'Igando': 3500 * 100,
  'Iyana Ipaja': 3500 * 100,
  'Ayobo': 3500 * 100,
  'Ipaja': 3500 * 100,
  'Akowonjo': 3500 * 100,
  'Gowon Estate': 3500 * 100,
  'Command': 3500 * 100,
  'Abesan Estate': 3500 * 100,

  // Zone 11 — ₦5,000
  'Ikorodu': 5000 * 100,
  'Agric Ikorodu': 5000 * 100,
  'Igbogbo': 5000 * 100,
  'Ebute Ikorodu': 5000 * 100,
  'Owode': 5000 * 100,
  'Bayeku': 5000 * 100,

  // Zone 12 — ₦5,500
  'Badagry': 5500 * 100,
  'Ojo': 5500 * 100,
  'Alaba': 5500 * 100,
  'Okokomaiko': 5500 * 100,
  'Ijanikin': 5500 * 100,
  'Trade Fair': 5500 * 100,
  'Volkswagen': 5500 * 100,

  // Zone 13 — ₦5,500
  'Ibeju-Lekki': 5500 * 100,
  'Lakowe': 5500 * 100,
  'Awoyaya': 5500 * 100,
  'Abijo': 5500 * 100,
  'Bogije': 5500 * 100,
  'Eleko': 5500 * 100,
  'Epe': 5500 * 100

};


function getLagosDeliveryFee(area) {

  if (!area) {
    return null;
  }

  return LAGOS_DELIVERY_PRICES[area] ?? null;

}

app.post(
  '/checkout/create-order',
  async function(req, res) {

    const client =
      await pool.connect();


    try {

      const {
        cart,
        measurements,
        saveMeasurements,
        delivery
      } = req.body;


      if (
        !Array.isArray(cart) ||
        cart.length === 0
      ) {

        return res.status(400).json({
          error: 'Your cart is empty.'
        });

      }


      if (
        !delivery ||
        !delivery.firstName ||
        !delivery.lastName ||
        !delivery.email ||
        !delivery.phone ||
        !delivery.address ||
        !delivery.city ||
        !delivery.state
      ) {

        return res.status(400).json({
          error:
            'Delivery information is incomplete.'
        });

      }


      await client.query('BEGIN');


      const verifiedItems = [];

      let subtotal = 0;


      for (const item of cart) {

        const quantity =
          Number(item.quantity);


        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 3
        ) {

          throw new Error(
            'Invalid product quantity.'
          );

        }


        const productResult =
          await client.query(
            `
              SELECT
                id,
                name,
                price,
                image_url,
                stock_quantity,
                is_active
              FROM products
              WHERE id = $1
              LIMIT 1
            `,
            [item.productId]
          );


        if (
          productResult.rows.length === 0
        ) {

          throw new Error(
            'A product in your cart no longer exists.'
          );

        }


        const product =
          productResult.rows[0];


        if (
          Number(product.is_active) !== 1
        ) {

          throw new Error(
            product.name +
            ' is currently unavailable.'
          );

        }


        if (
          Number(product.stock_quantity) <
          quantity
        ) {

          throw new Error(
            'Not enough stock for ' +
            product.name +
            '.'
          );

        }


        const unitPrice =
          Number(product.price) +
          getSizePrice(item.size) +
          getNailTypePrice(
            item.nailType
          );


        subtotal +=
          unitPrice * quantity;


        verifiedItems.push({

          productId:
            product.id,

          name:
            product.name,

          unitPrice:
            unitPrice,

          quantity:
            quantity,

          image:
            product.image_url,

          size:
            item.size || null,

          nailType:
            item.nailType || null,

          shape:
            item.shape || null,

          finish:
            item.finish || null,

          length:
            item.length || null

        });

      }


      /*
       * DELIVERY:
       *
       * Keep this at zero until we define
       * BeautyLoft's actual delivery pricing.
       */

      const deliveryArea =
  delivery.area;

const deliveryFee =
  getLagosDeliveryFee(deliveryArea);

if (deliveryFee === null) {

  await client.query('ROLLBACK');

  return res.status(400).json({
    success: false,
    message:
      'Please select a valid Lagos delivery area.'
  });

}

const total =
  subtotal + deliveryFee;


      const orderRef =
        'BL-' +
        Date.now().toString(36).toUpperCase() +
        '-' +
        Math.random()
          .toString(36)
          .slice(2, 7)
          .toUpperCase();


      /*
 * Get logged-in customer
 * from Authorization token.
 */

const userId =
  await getUserIdFromToken(req);


if (!userId) {

  await client.query('ROLLBACK');

  return res.status(401).json({
    success: false,
    message:
      'Please log in before placing your order.'
  });

}


const orderResult =
  await client.query(
    `
      INSERT INTO orders (

        user_id,
        order_ref,

        first_name,
        last_name,

        email,
        phone,

        delivery_address,
        city,
        state,
        delivery_area,

        delivery_instructions,

        subtotal,
        delivery_fee,
        total,
        total_amount,

        payment_status,
        order_status

      )

      VALUES (
        $1, $2,
        $3, $4,
        $5, $6,
        $7, $8, $9, $10,
        $11,
        $12, $13, $14, $15,
        'pending',
        'pending'
      )

      RETURNING
        id,
        order_ref,
        subtotal,
        delivery_fee,
        total,
        payment_status,
        order_status
    `,
    [
      userId,
      orderRef,

      delivery.firstName,
      delivery.lastName,

      delivery.email,
      delivery.phone,

      delivery.address,
      delivery.city,
      delivery.state,
      deliveryArea,

      delivery.instructions || null,

      subtotal,
      deliveryFee,
      total,
      total
    ]
  );


      const order =
        orderResult.rows[0];


      for (
        const item of verifiedItems
      ) {

       await client.query(
  `
    INSERT INTO order_items (

      order_id,
      product_id,
      product_name,

      unit_price,
      price,
      quantity,

      size,
      nail_type,
      shape,
      finish,
      length,

      image_url

    )

    VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12
    )
  `,
  [
    order.id,
    item.productId,
    item.name,

    item.unitPrice,
    item.unitPrice,
    item.quantity,

    item.size,
    item.nailType,
    item.shape,
    item.finish,
    item.length,

    item.image
  ]
);

      }


      if (measurements) {

        await client.query(
          `
            INSERT INTO order_measurements (

              order_id,

              left_thumb,
              left_index,
              left_middle,
              left_ring,
              left_pinky,

              right_thumb,
              right_index,
              right_middle,
              right_ring,
              right_pinky

            )

            VALUES (
              $1,
              $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11
            )
          `,
          [
            order.id,

            measurements.leftThumb,
            measurements.leftIndex,
            measurements.leftMiddle,
            measurements.leftRing,
            measurements.leftPinky,

            measurements.rightThumb,
            measurements.rightIndex,
            measurements.rightMiddle,
            measurements.rightRing,
            measurements.rightPinky
          ]
        );

      }


      /*
       * Save measurements only when:
       *
       * 1. customer selected the option
       * 2. customer is logged in
       */

      if (
        saveMeasurements &&
        userId &&
        measurements
      ) {

        await client.query(
          `
            INSERT INTO saved_measurements (

              user_id,

              left_thumb,
              left_index,
              left_middle,
              left_ring,
              left_pinky,

              right_thumb,
              right_index,
              right_middle,
              right_ring,
              right_pinky

            )

            VALUES (
              $1,
              $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11
            )

            ON CONFLICT (user_id)

            DO UPDATE SET

              left_thumb =
                EXCLUDED.left_thumb,

              left_index =
                EXCLUDED.left_index,

              left_middle =
                EXCLUDED.left_middle,

              left_ring =
                EXCLUDED.left_ring,

              left_pinky =
                EXCLUDED.left_pinky,

              right_thumb =
                EXCLUDED.right_thumb,

              right_index =
                EXCLUDED.right_index,

              right_middle =
                EXCLUDED.right_middle,

              right_ring =
                EXCLUDED.right_ring,

              right_pinky =
                EXCLUDED.right_pinky,

              updated_at =
                CURRENT_TIMESTAMP
          `,
          [
            userId,

            measurements.leftThumb,
            measurements.leftIndex,
            measurements.leftMiddle,
            measurements.leftRing,
            measurements.leftPinky,

            measurements.rightThumb,
            measurements.rightIndex,
            measurements.rightMiddle,
            measurements.rightRing,
            measurements.rightPinky
          ]
        );

      }


      await client.query('COMMIT');


      return res.status(201).json({

        success: true,

        order: {
          id: order.id,
          reference: order.order_ref,
          subtotal: order.subtotal,
          deliveryFee:
            order.delivery_fee,
          total: order.total,
          paymentStatus:
            order.payment_status
        }

      });


    } catch (error) {

      await client.query('ROLLBACK');

      console.error(
        'Checkout error:',
        error
      );


      return res.status(500).json({

        error:
          error.message ||
          'Checkout failed.'

      });


    } finally {

      client.release();

    }

  }
);

app.post(
  '/payment/initialize',
  async function(req, res) {

    try {

      const userId =
        await getUserIdFromToken(req);


      if (!userId) {

        return res.status(401).json({
          success: false,
          error:
            'Please log in before making payment.'
        });

      }


      const { orderId } = req.body;


      if (!orderId) {

        return res.status(400).json({
          success: false,
          error:
            'Order ID is required.'
        });

      }


      /*
       * Get the order directly from our database.
       *
       * IMPORTANT:
       * We do NOT accept the payment amount
       * from the frontend.
       */

      const orderResult =
        await pool.query(
          `
            SELECT
              id,
              user_id,
              order_ref,
              email,
              total,
              payment_status
            FROM orders
            WHERE id = $1
              AND user_id = $2
            LIMIT 1
          `,
          [
            orderId,
            userId
          ]
        );


      if (
        orderResult.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          error:
            'Order not found.'
        });

      }


      const order =
        orderResult.rows[0];


      if (
        order.payment_status === 'paid'
      ) {

        return res.status(400).json({
          success: false,
          error:
            'This order has already been paid.'
        });

      }


      if (
        !order.email ||
        !order.total
      ) {

        return res.status(400).json({
          success: false,
          error:
            'Order payment information is incomplete.'
        });

      }


      /*
       * Use BeautyLoft's order reference
       * as the Paystack reference.
       */

      const paystackResponse =
        await fetch(
          'https://api.paystack.co/transaction/initialize',
          {
            method: 'POST',

            headers: {
              Authorization:
                'Bearer ' +
                process.env.PAYSTACK_SECRET_KEY,

              'Content-Type':
                'application/json'
            },

           body:
  JSON.stringify({
    email:
      order.email,

    amount:
      String(order.total),

    reference:
      order.order_ref,

    currency:
      'NGN',

    callback_url:
      'https://beautyloft.vercel.app/payment-callback.html'
  })
          }
        );


      const paystackData =
        await paystackResponse.json();


      if (
        !paystackResponse.ok ||
        !paystackData.status
      ) {

        console.error(
          'Paystack initialization error:',
          paystackData
        );

        return res.status(502).json({
          success: false,
          error:
            paystackData.message ||
            'Unable to initialize payment.'
        });

      }


      /*
       * Save Paystack reference against
       * the BeautyLoft order.
       */

      await pool.query(
        `
          UPDATE orders
          SET payment_reference = $1
          WHERE id = $2
            AND user_id = $3
        `,
        [
          paystackData.data.reference,
          order.id,
          userId
        ]
      );


      return res.json({

        success: true,

        authorizationUrl:
          paystackData.data.authorization_url,

        reference:
          paystackData.data.reference

      });


    } catch (error) {

      console.error(
        'Payment initialization error:',
        error
      );


      return res.status(500).json({
        success: false,
        error:
          'Unable to initialize payment.'
      });

    }

  }
);

app.get(
  '/checkout/saved-measurements',
  async function(req, res) {

    try {

      if (
        !req.session ||
        !req.session.userId
      ) {

        return res.json({
          measurements: null
        });

      }


      const result =
        await pool.query(
          `
            SELECT *
            FROM saved_measurements
            WHERE user_id = $1
            LIMIT 1
          `,
          [req.session.userId]
        );


      if (!result.rows.length) {

        return res.json({
          measurements: null
        });

      }


      const row =
        result.rows[0];


      return res.json({

        measurements: {

          leftThumb:
            row.left_thumb,

          leftIndex:
            row.left_index,

          leftMiddle:
            row.left_middle,

          leftRing:
            row.left_ring,

          leftPinky:
            row.left_pinky,

          rightThumb:
            row.right_thumb,

          rightIndex:
            row.right_index,

          rightMiddle:
            row.right_middle,

          rightRing:
            row.right_ring,

          rightPinky:
            row.right_pinky

        }

      });


    } catch (error) {

      console.error(error);

      return res.status(500).json({
        error:
          'Unable to load measurements.'
      });

    }

  }
);

async function completePaidOrder(
  client,
  transaction
) {

  await client.query('BEGIN');

  try {

    const reference =
      transaction.reference;


    /*
     * Find and lock the order.
     *
     * Both the browser verification
     * and Paystack webhook can use this.
     */

    const orderResult =
      await client.query(
        `
          SELECT
            id,
            user_id,
            order_ref,
            total,
            payment_status

          FROM orders

          WHERE payment_reference = $1

          LIMIT 1

          FOR UPDATE
        `,
        [
          reference
        ]
      );


    if (
      orderResult.rows.length === 0
    ) {

      throw new Error(
        'ORDER_NOT_FOUND'
      );

    }


    const order =
      orderResult.rows[0];


    /*
     * Already processed.
     *
     * This is what protects us if both
     * the callback and webhook arrive.
     */

    if (
      order.payment_status === 'paid'
    ) {

      await client.query('COMMIT');

      return {
        success: true,
        paid: true,
        alreadyProcessed: true,
        orderReference:
          order.order_ref
      };

    }


    /*
     * Paystack amounts are in kobo.
     * Our order total is also in kobo.
     */

    if (
      Number(transaction.amount) !==
      Number(order.total)
    ) {

      throw new Error(
        'AMOUNT_MISMATCH'
      );

    }


    /*
     * Make sure the Paystack reference
     * belongs to this BeautyLoft order.
     */

    if (
      transaction.reference !==
      order.order_ref
    ) {

      throw new Error(
        'REFERENCE_MISMATCH'
      );

    }


    /*
     * Get the products in this order.
     */

    const itemsResult =
      await client.query(
        `
          SELECT
            product_id,
            product_name,
            quantity

          FROM order_items

          WHERE order_id = $1
        `,
        [
          order.id
        ]
      );


    if (
      itemsResult.rows.length === 0
    ) {

      throw new Error(
        'NO_ORDER_ITEMS'
      );

    }


    /*
     * Deduct stock.
     */

    for (
      const item of itemsResult.rows
    ) {

      const stockResult =
        await client.query(
          `
            UPDATE products

            SET stock_quantity =
              stock_quantity - $1

            WHERE id = $2
              AND stock_quantity >= $1

            RETURNING
              id,
              stock_quantity
          `,
          [
            Number(item.quantity),
            item.product_id
          ]
        );


      if (
        stockResult.rows.length === 0
      ) {

        throw new Error(
          'INSUFFICIENT_STOCK:' +
          item.product_name
        );

      }

    }


    /*
     * Payment is valid and stock
     * has been successfully deducted.
     */

    await client.query(
      `
        UPDATE orders

        SET
          payment_status = 'paid',
          payment_reference = $1,
          order_status = 'confirmed'

        WHERE id = $2
      `,
      [
        transaction.reference,
        order.id
      ]
    );


    await client.query('COMMIT');


    return {
      success: true,
      paid: true,
      alreadyProcessed: false,
      orderReference:
        order.order_ref
    };


  } catch (error) {

    try {

      await client.query(
        'ROLLBACK'
      );

    } catch (rollbackError) {

      console.error(
        'Payment rollback error:',
        rollbackError
      );

    }


    throw error;

  }

}

app.get(
  '/payment/verify/:reference',
  async function(req, res) {

    const client =
      await pool.connect();


    try {

      const userId =
        await getUserIdFromToken(req);


      if (!userId) {

        return res.status(401).json({
          success: false,
          error:
            'Please log in to verify payment.'
        });

      }


      const reference =
        req.params.reference;


      if (!reference) {

        return res.status(400).json({
          success: false,
          error:
            'Payment reference is required.'
        });

      }


      /*
       * Make sure this payment reference
       * belongs to the logged-in customer.
       */

      const orderCheck =
        await pool.query(
          `
            SELECT id
            FROM orders
            WHERE payment_reference = $1
              AND user_id = $2
            LIMIT 1
          `,
          [
            reference,
            userId
          ]
        );


      if (
        orderCheck.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          error:
            'Order not found.'
        });

      }


      /*
       * Verify the transaction directly
       * with Paystack.
       */

      const paystackResponse =
        await fetch(
          'https://api.paystack.co/transaction/verify/' +
          encodeURIComponent(reference),
          {
            method: 'GET',

            headers: {
              Authorization:
                'Bearer ' +
                process.env.PAYSTACK_SECRET_KEY
            }
          }
        );


      const paystackData =
        await paystackResponse.json();


      if (
        !paystackResponse.ok ||
        !paystackData.status
      ) {

        console.error(
          'Paystack verification error:',
          paystackData
        );

        return res.status(502).json({
          success: false,
          error:
            paystackData.message ||
            'Unable to verify payment.'
        });

      }


      const transaction =
        paystackData.data;


      if (
        transaction.status !== 'success'
      ) {

        return res.status(400).json({
          success: false,
          paid: false,
          error:
            'Payment has not been completed.'
        });

      }


      /*
       * Complete the BeautyLoft order.
       */

      const result =
        await completePaidOrder(
          client,
          transaction
        );


      return res.json(result);


    } catch (error) {

      console.error(
        'Payment verification error:',
        error
      );


      if (
        error.message ===
        'AMOUNT_MISMATCH'
      ) {

        return res.status(400).json({
          success: false,
          paid: false,
          error:
            'Payment amount does not match the order total.'
        });

      }


      if (
        error.message ===
        'REFERENCE_MISMATCH'
      ) {

        return res.status(400).json({
          success: false,
          paid: false,
          error:
            'Payment reference does not match the order.'
        });

      }


      if (
        error.message ===
        'NO_ORDER_ITEMS'
      ) {

        return res.status(400).json({
          success: false,
          paid: false,
          error:
            'No products were found for this order.'
        });

      }


      if (
        error.message.startsWith(
          'INSUFFICIENT_STOCK:'
        )
      ) {

        const productName =
          error.message.split(':')
            .slice(1)
            .join(':');


        return res.status(409).json({
          success: false,
          paid: false,
          error:
            'There is no longer enough stock for ' +
            productName +
            '. Please contact BeautyLoft.'
        });

      }


      return res.status(500).json({
        success: false,
        error:
          'Unable to verify payment.'
      });


    } finally {

      client.release();

    }

  }
);

app.post(
  '/payment/webhook',
  async function(req, res) {

    /*
     * Verify that this request
     * actually came from Paystack.
     */

    const hash =
      crypto
        .createHmac(
          'sha512',
          process.env.PAYSTACK_SECRET_KEY
        )
        .update(
          req.rawBody
        )
        .digest('hex');


    const paystackSignature =
      req.headers[
        'x-paystack-signature'
      ];


    if (
      !paystackSignature ||
      hash !== paystackSignature
    ) {

      console.error(
        'Invalid Paystack webhook signature.'
      );

      return res.sendStatus(401);

    }


    /*
     * Acknowledge events we don't
     * need to process.
     */

    const event =
      req.body;


    if (
      event.event !==
      'charge.success'
    ) {

      return res.sendStatus(200);

    }


    const transaction =
      event.data;


    /*
     * Make sure the transaction
     * information exists.
     */

    if (
      !transaction ||
      !transaction.reference
    ) {

      return res.sendStatus(200);

    }


    const client =
      await pool.connect();


    try {

      /*
       * IMPORTANT:
       *
       * Even though the webhook signature
       * is valid, verify the transaction
       * directly with Paystack again.
       */

      const paystackResponse =
        await fetch(
          'https://api.paystack.co/transaction/verify/' +
          encodeURIComponent(
            transaction.reference
          ),
          {
            method: 'GET',

            headers: {
              Authorization:
                'Bearer ' +
                process.env.PAYSTACK_SECRET_KEY
            }
          }
        );


      const paystackData =
        await paystackResponse.json();


      if (
        !paystackResponse.ok ||
        !paystackData.status ||
        !paystackData.data ||
        paystackData.data.status !==
          'success'
      ) {

        console.error(
          'Webhook Paystack verification failed:',
          paystackData
        );

        return res.sendStatus(200);

      }


      /*
       * Use the SAME payment completion
       * logic as the browser callback.
       */

      const result =
        await completePaidOrder(
          client,
          paystackData.data
        );


      console.log(
        'Paystack webhook processed:',
        result.orderReference,
        result.alreadyProcessed
          ? '(already processed)'
          : '(payment confirmed)'
      );


      return res.sendStatus(200);


    } catch (error) {

      console.error(
        'Paystack webhook error:',
        error
      );


      /*
       * Paystack retries unsuccessful
       * webhook deliveries, so return 500
       * when our processing genuinely fails.
       */

      return res.sendStatus(500);


    } finally {

      client.release();

    }

  }
);