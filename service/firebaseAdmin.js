// service/firebaseAdmin.js
const admin = require('firebase-admin');
const path = require('path');

function loadServiceAccount() {
  // Option A: JSON string in env (recommended for Render)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err);
      throw err;
    }
  }

  // Option B: file path (legacy)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
  try {
    return require(path.resolve(serviceAccountPath));
  } catch (err) {
    console.error('Failed to load Firebase service account file at', serviceAccountPath, err);
    throw err;
  }
}

const serviceAccount = loadServiceAccount();

// Make sure project id exists (very important)
const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('Firebase project_id not found in service account JSON and FIREBASE_PROJECT_ID not set.');
  console.error('Please provide a valid service account that contains "project_id" or set FIREBASE_PROJECT_ID env var.');
  // Optionally throw here to prevent app from starting in misconfigured state
  // throw new Error('Missing Firebase project id');
}

console.log('Initializing Firebase Admin with projectId =', projectId);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId
});

module.exports = admin;
