// service/notificationService.js
// Robust helper for FCM v1 send + token testing

const path = require('path');
const { GoogleAuth } = require('google-auth-library');

// dynamic import helper for node-fetch to avoid ESM issues across environments
async function getFetch() {
  try {
    // prefer node-fetch v2 (commonjs)
    const nf = require('node-fetch');
    return nf;
  } catch (_) {
    // fallback to dynamic import (works if node-fetch v3 is installed)
    const mod = await import('node-fetch');
    return mod.default;
  }
}

function loadServiceAccount() {
  if (process.env.SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    } catch (err) {
      console.error('SERVICE_ACCOUNT_KEY is set but JSON.parse failed:', err.message);
      throw err;
    }
  }

  // fallback local file for local dev only
  const localPath = path.resolve(__dirname, '..', 'etc', 'secrets', 'serviceAccountKey.json');
  try {
    /* eslint-disable global-require, import/no-dynamic-require */
    return require(localPath);
  } catch (err) {
    console.error('No service account in SERVICE_ACCOUNT_KEY and local file not found at', localPath);
    throw err;
  }
}

const serviceAccount = loadServiceAccount();

// prefer explicit env var PROJECT_ID, else use project_id from service account
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (!PROJECT_ID) {
  throw new Error('Missing Firebase project id. Set FIREBASE_PROJECT_ID or provide it in the service account JSON (project_id).');
}

const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse || !tokenResponse.token) {
    throw new Error('Failed to obtain access token from GoogleAuth');
  }
  return tokenResponse.token;
}

/**
 * sendToToken - send a single message to a single FCM registration token (v1 HTTP)
 * @param {string} token registration token
 * @param {object} payload { title, body, data }
 */
async function sendToToken(token, payload = {}) {
  if (!token) throw new Error('Missing registration token');

  const fetch = await getFetch();
  const accessToken = await getAccessToken();

  const message = {
    message: {
      token: token,
      notification: {
        title: payload.title || 'Notification',
        body: payload.body || ''
      },
      data: payload.data || {}
    }
  };

  console.log('Sending message to FCM endpoint:', FCM_ENDPOINT);
  console.log('Message token (first 12 chars):', token.slice(0, 12) + '...');

  const res = await fetch(FCM_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message),
    // optional: timeout handling if your fetch supports it
  });

  let body;
  try {
    body = await res.json();
  } catch (err) {
    body = await res.text().catch(() => '<unreadable body>');
  }

  console.log('FCM HTTP status:', res.status);
  console.log('FCM response body:', JSON.stringify(body, null, 2));

  if (!res.ok) {
    const err = new Error(`FCM send failed: HTTP ${res.status} - ${JSON.stringify(body)}`);
    err.response = body;
    throw err;
  }

  return body;
}

/**
 * sendNotificationToUserFromDb - fetches a user from DB (by userId), reads fcmTokens, sends messages
 * @param {Model} UserModel - mongoose User model (pass require('../models/User'))
 * @param {string} userId
 * @param {{title:string,body:string,data?:object}} payload
 */
async function sendNotificationToUserFromDb(UserModel, userId, payload = {}) {
  if (!UserModel) throw new Error('UserModel required');
  if (!userId) throw new Error('userId required');

  const user = await UserModel.findById(userId).select('fcmTokens fcmToken username name');
  if (!user) throw new Error(`User not found: ${userId}`);

  // gather tokens: support array fcmTokens entries or legacy fcmToken string
  const tokens = [];
  if (Array.isArray(user.fcmTokens) && user.fcmTokens.length) {
    user.fcmTokens.forEach(e => {
      if (e && e.token) tokens.push(e.token);
      else if (typeof e === 'string') tokens.push(e);
    });
  }
  if (user.fcmToken && typeof user.fcmToken === 'string') tokens.push(user.fcmToken);

  if (tokens.length === 0) {
    throw new Error('No FCM tokens found for user ' + userId);
  }

  const results = [];
  for (const tk of Array.from(new Set(tokens))) {
    try {
      const r = await sendToToken(tk, payload);
      results.push({ token: tk, ok: true, resp: r });
    } catch (err) {
      console.error('Send to token failed', tk.slice(0, 12) + '...', err.message || err);
      results.push({ token: tk, ok: false, error: err.message || err.toString(), response: err.response || null });
    }
  }

  return results;
}

module.exports = {
  getAccessToken,
  sendToToken,
  sendNotificationToUserFromDb,
};
