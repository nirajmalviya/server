// routes/tasks.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');
const firebaseAdmin = require('../service/firebaseAdmin'); // your admin instance

console.log('Loading tasks routes...');

/**
 * GET /api/tasks
 * - If admin: return all tasks
 * - Otherwise: return tasks where assignedTo includes the current user OR createdBy is the current user
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const userRole = req.user && req.user.role; // adjust if your auth puts role elsewhere

    let query;
    if (userRole === 'admin') {
      query = {};
    } else {
      query = { $or: [{ assignedTo: userId }, { createdBy: userId }] };
    }

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .populate('assignedTo', '-password -fcmTokens -fcmToken') // remove sensitive fields
      .populate('createdBy', '-password -fcmTokens -fcmToken');

    return res.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return res.status(500).send('Server error');
  }
});

/**
 * GET /api/tasks/my
 * - Returns only tasks assigned to the logged-in user
 */
router.get('/my', auth, async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const tasks = await Task.find({ assignedTo: userId })
      .sort({ createdAt: -1 })
      .populate('assignedTo', '-password -fcmTokens -fcmToken')
      .populate('createdBy', '-password -fcmTokens -fcmToken');

    return res.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks/my error:', err);
    return res.status(500).send('Server error');
  }
});

/**
 * GET /api/tasks/users
 * - Return users (this preserves your previous behaviour but moved to /users)
 */
router.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find().select('-password -fcmTokens -fcmToken');
    return res.json({ users });
  } catch (err) {
    console.error('GET /api/tasks/users error:', err);
    return res.status(500).send('Server error');
  }
});

/**
 * Helper: send notifications to assigned users (sends to all tokens found)
 * - tokenToUserIds maps token -> [userId,...] so cleanup can remove token for all users if invalid
 */
async function sendTaskAssignedNotifications(task, assignedUserIds = []) {
  if (!firebaseAdmin || !firebaseAdmin.messaging) {
    console.warn('firebaseAdmin not configured — skipping push send');
    return;
  }
  try {
    // fetch users and their token fields
    const users = await User.find({ _id: { $in: assignedUserIds } }).select('fcmTokens fcmToken name email');

    // build tokens array and map token -> [userId,...]
    const tokens = [];
    const tokenToUserIds = {}; // { token: [userId1, userId2] }
    users.forEach(u => {
      const uid = u._id.toString();
      // collect from fcmTokens array if exists
      if (Array.isArray(u.fcmTokens)) {
        u.fcmTokens.forEach(entry => {
          const tk = (entry && entry.token) ? entry.token : null;
          if (tk) {
            if (!tokenToUserIds[tk]) tokenToUserIds[tk] = [];
            if (!tokenToUserIds[tk].includes(uid)) tokenToUserIds[tk].push(uid);
            tokens.push(tk);
          }
        });
      }
      // legacy single token support
      if (u.fcmToken && typeof u.fcmToken === 'string') {
        const tk = u.fcmToken;
        if (!tokenToUserIds[tk]) tokenToUserIds[tk] = [];
        if (!tokenToUserIds[tk].includes(uid)) tokenToUserIds[tk].push(uid);
        tokens.push(tk);
      }
    });

    // dedupe tokens but keep index alignment for responses? we'll dedupe to avoid duplicate sends
    const uniqueTokens = Array.from(new Set(tokens));
    if (uniqueTokens.length === 0) return;

    const message = {
      notification: {
        title: 'New Task Assigned',
        body: task.title || 'You have a new task assigned'
      },
      data: {
        taskId: task._id.toString(),
        type: 'task_assigned'
      },
      tokens: uniqueTokens
    };

    const resp = await firebaseAdmin.messaging().sendMulticast(message);
    console.log('FCM sendMulticast results', { success: resp.successCount, failure: resp.failureCount });

    if (resp.failureCount > 0) {
      // resp.responses aligns with uniqueTokens index
      const failedTokens = [];
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const badToken = uniqueTokens[idx];
          const errorCode = r.error && r.error.code;
          failedTokens.push({ token: badToken, error: errorCode });
        }
      });

      // Remove failed tokens from user documents
      for (const { token, error } of failedTokens) {
        try {
          console.log('Removing invalid token:', token, 'error:', error);
          // remove from fcmTokens array wherever it exists
          await User.updateMany({ 'fcmTokens.token': token }, { $pull: { fcmTokens: { token } } });
          // also clear legacy fcmToken string where it matches
          await User.updateMany({ fcmToken: token }, { $unset: { fcmToken: '' } });
        } catch (cleanupErr) {
          console.error('Error cleaning up invalid token:', token, cleanupErr);
        }
      }
    }
  } catch (err) {
    console.error('Error sending task notifications:', err);
  }
}

// POST /api/tasks  <-- create task endpoint (sends notifications to assigned users)
router.post('/', auth, async (req, res) => {
  console.log('POST /api/tasks hit - body:', req.body, 'user:', req.user && req.user.id);
  try {
    const { title, description, assignedTo } = req.body;

    if (!title || title.toString().trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }

    const assignedArr = Array.isArray(assignedTo)
      ? assignedTo
      : (assignedTo ? [assignedTo] : []);

    const newTask = new Task({
      title: title.toString(),
      description: description || '',
      assignedTo: assignedArr,
      createdBy: req.user && req.user.id
    });

    await newTask.save();
    await newTask.populate('assignedTo', '-password -fcmTokens -fcmToken');
    await newTask.populate('createdBy', '-password -fcmTokens -fcmToken');

    // fire-and-forget notification send (non-blocking for client) but we'll attempt to await/send and log
    sendTaskAssignedNotifications(newTask, assignedArr).catch(err => console.error('Notification send error:', err));

    return res.status(201).json({ message: 'Task created', task: newTask });
  } catch (err) {
    console.error('Error creating task:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/tasks/device-token
 * - Save/upsert a device token for the current user (supports multiple tokens per user)
 * Request body: { fcmToken: string, platform?: string }
 */
router.post('/device-token', auth, async (req, res) => {
  try {
    const { fcmToken, platform } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });

    // Add token to fcmTokens array only if not present
    await User.updateOne(
      { _id: req.user.id, 'fcmTokens.token': { $ne: fcmToken } },
      { $push: { fcmTokens: { token: fcmToken, platform: platform || '', createdAt: new Date() } } }
    );

    // Also keep legacy single-field for backwards compatibility
    await User.findByIdAndUpdate(req.user.id, { $set: { fcmToken } });

    return res.json({ msg: 'Token saved' });
  } catch (err) {
    console.error('POST /api/tasks/device-token error:', err);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
