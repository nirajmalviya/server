// service/firebaseAdmin.js
'use strict';

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function loadServiceAccount() {
  // 1) Preferred: full JSON in env var (works well on Render)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      // Allow both stringified JSON and already-parsed object
      if (typeof raw === 'string') {
        return JSON.parse(raw);
      }
      return raw;
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err.message || err);
      throw err;
    }
  }

  // 2) Optional alternate env var name (some scripts use SERVICE_ACCOUNT_KEY)
  if (process.env.SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.SERVICE_ACCOUNT_KEY;
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    } catch (err) {
      console.error('Failed to parse SERVICE_ACCOUNT_KEY:', err.message || err);
      throw err;
    }
  }

  // 3) Fallback: JSON file path environment variable or default path
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || process.env.SERVICE_ACCOUNT_PATH
    || path.resolve(__dirname, '..', 'serviceAccountKey.json');

  try {
    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(`Service account file not found at path: ${serviceAccountPath}`);
    }
    const loaded = require(serviceAccountPath);
    return loaded;
  } catch (err) {
    console.error('Failed to load Firebase service account file at', serviceAccountPath, err.message || err);
    throw err;
  }
}

let serviceAccount;
try {
  serviceAccount = loadServiceAccount();
} catch (err) {
  // Re-throw after logging so app will fail fast if misconfigured
  console.error('Fatal: cannot load Firebase service account. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH correctly.');
  throw err;
}

// Determine project id: prefer explicit env var, else use service account project_id
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (!projectId) {
  const msg = 'Firebase project_id not found in service account JSON and FIREBASE_PROJECT_ID not set.';
  console.error(msg);
  throw new Error(msg);
}

console.log('Initializing Firebase Admin with projectId =', projectId);

// Initialize only once (protect against double-require)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId
  });
} else {
  console.log('Firebase Admin already initialized - reusing existing app.');
}

// Optional: export a helper to return the messaging instance (makes mocking/testing easier)
function getMessaging() {
  return admin.messaging();
}

module.exports = {
  admin,
  getMessaging
};
