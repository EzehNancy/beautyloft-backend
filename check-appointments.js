const db = require('./database.js');
const rows = db.prepare('SELECT * FROM appointments').all();
console.log(rows);