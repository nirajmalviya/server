const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');


// get all users (for admin to select)
router.get('/', auth, async (req, res) => {
try {
const users = await User.find().select('-password');
res.json(users);
} catch (err) {
console.error(err);
res.status(500).send('Server error');
}
});


// update fcm token for current user
router.post('/device-token', auth, async (req, res) => {
  try {
    const { fcmToken, platform } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });

    // Add token only if not exists
    await User.updateOne(
      { _id: req.user.id, 'fcmTokens.token': { $ne: fcmToken } },
      { $push: { fcmTokens: { token: fcmToken, platform: platform || '' } } }
    );

    return res.json({ msg: 'Token saved' });
  } catch (err) {
    console.error('POST /api/users/device-token error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/remove-token', auth, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });

    await User.updateOne({ _id: req.user.id }, { $pull: { fcmTokens: { token: fcmToken } } });
    return res.json({ msg: 'Token removed' });
  } catch (err) {
    console.error('POST /api/users/remove-token error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;