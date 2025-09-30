// scripts/testNotify.js
// Usage: node scripts/testNotify.js <userId> "Title" "Body"
const mongoose = require('mongoose');
const User = require('../models/User'); // adjust path
const { sendNotificationToUserFromDb, getAccessToken } = require('../service/notificationService');

async function main() {
  const [,, userId, title = 'Test', body = 'Hello from server'] = process.argv;
  if (!userId) {
    console.error('Usage: node scripts/testNotify.js <userId> "Title" "Body"');
    process.exit(2);
  }

  // connect to mongo (set MONGO_URI env var)
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/test';
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    console.log('Testing getAccessToken() ...');
    const token = await getAccessToken();
    console.log('Access token obtained (first 20 chars):', token.slice(0, 20) + '...');

    console.log('Sending notification to userId:', userId);
    const results = await sendNotificationToUserFromDb(User, userId, { title, body, data: { test: '1' } });
    console.log('Send results:', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Test failed:', err.message || err);
    if (err.response) console.error('Response:', err.response);
  } finally {
    await mongoose.disconnect();
  }
}

main();
