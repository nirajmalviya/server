require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks'); // This route handles admin task creation + FCM
const firebaseAdmin = require('./service/firebaseAdmin'); // ensure this initializes Firebase Admin SDK

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);

// Health check route (optional)
app.get('/', (req, res) => res.send('Server is running'));

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('✅ MongoDB connected');

    // Start server
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('❌ Mongo connection error', err));
  console.log('Registered routes:');
app._router.stack
  .filter(r => r.route)
  .forEach(r => {
    const methods = Object.keys(r.route.methods).map(m => m.toUpperCase()).join(',');
    console.log(`${methods} ${r.route.path}`);
  });