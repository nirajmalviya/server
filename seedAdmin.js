// seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const email = 'admin@example.com';
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('Admin already exists:', existing.email);
    process.exit(0);
  }
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('Admin@123', salt);

  const admin = new User({ name: 'Admin', email, password: hash, role: 'admin' });
  await admin.save();
  console.log('Admin created:', email, 'password: Admin@123');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
