const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
name: { type: String, required: true },
email: { type: String, required: true, unique: true },
password: { type: String, required: true },
role: { type: String, enum: ['admin','user'], default: 'user' },
fcmTokens: [{
  token: { type: String },
  platform: { type: String },
  createdAt: { type: Date, default: Date.now }
}],
fcmToken: { type: String }
}, { timestamps: true });


module.exports = mongoose.model('User', userSchema);