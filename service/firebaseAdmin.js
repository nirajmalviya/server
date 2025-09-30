const admin = require('firebase-admin');
const path = require('path');


const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
const serviceAccount = require(path.resolve(serviceAccountPath));


admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});


module.exports = admin;