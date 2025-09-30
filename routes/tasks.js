// routes/tasks.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');

// Use the notificationService you provided
const notificationService = require('../service/notificationService');

console.log('Loading tasks routes...');

/**
 * GET /api/tasks
 * - If admin: return all tasks
 * - Otherwise: return tasks where assignedTo includes the current user OR createdBy is the current user
 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const userRole = req.user && req.user.role;

    let query;
    if (userRole === 'admin') {
      query = {};
    } else {
      query = { $or: [{ assignedTo: userId }, { createdBy: userId }] };
    }

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .populate('assignedTo', '-password -fcmTokens -fcmToken')
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
 * - Return users (preserves previous behaviour)
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
 * Verbose: send notifications to assigned users using your notificationService
 * - Logs every step: DB fetch, access token (inside service), per-token response, cleanup
 */
async function sendTaskAssignedNotifications(task, assignedUserIds = []) {
  console.log(`Notification flow start for task ${task._id} (title: "${task.title}")`);
  if (!Array.isArray(assignedUserIds) || assignedUserIds.length === 0) {
    console.log('No assigned users, skipping notifications.');
    return { sent: 0, failed: 0, details: [] };
  }

  // 1) Fetch users
  console.log('Fetching users from DB for assignedUserIds:', assignedUserIds);
  const users = await User.find({ _id: { $in: assignedUserIds } }).select('fcmTokens fcmToken username name');
  console.log(`Fetched ${users.length} users from DB.`);

  const sendSummary = [];

  // 2) For each user, call notificationService with proper parameters
  for (const u of users) {
    const uid = u._id.toString();
    const who = u.username || u.name || uid;
    console.log(`Preparing to send notification to user ${uid} (${who})`);

    try {
      // FIXED: Pass UserModel as first parameter, userId as second, payload object as third
      const results = await notificationService.sendNotificationToUserFromDb(
        User,  // Pass the User model
        uid,   // User ID
        {      // Payload object
          title: `New Task: ${task.title}`,
          body: task.description || 'You have been assigned a new task',
          data: {
            taskId: task._id.toString(),
            taskTitle: task.title
          }
        }
      );
      console.log(`sendNotificationToUserFromDb results for ${uid}:`, JSON.stringify(results, null, 2));

      // gather failures for cleanup
      const failed = results.filter(r => !r.ok);
      sendSummary.push({ userId: uid, ok: failed.length === 0, results, failed });
    } catch (sendErr) {
      console.error(`sendNotificationToUserFromDb threw for user ${uid}:`, sendErr && (sendErr.message || sendErr));
      sendSummary.push({ userId: uid, ok: false, error: sendErr && (sendErr.message || sendErr) });
    }
  }

  // 3) Cleanup failed tokens (if any)
  const failedTokensToCleanup = [];
  sendSummary.forEach(entry => {
    if (entry.failed && entry.failed.length) {
      entry.failed.forEach(f => {
        if (f.token) {
          failedTokensToCleanup.push({ 
            token: f.token, 
            reason: f.error || 'unknown' 
          });
        }
      });
    }
  });

  if (failedTokensToCleanup.length > 0) {
    console.log('Cleaning up failed tokens:', JSON.stringify(failedTokensToCleanup.map(t => ({ tokenStart: t.token.slice(0, 12) + '...', reason: t.reason })), null, 2));
    for (const f of failedTokensToCleanup) {
      try {
        await User.updateMany({ 'fcmTokens.token': f.token }, { $pull: { fcmTokens: { token: f.token } } });
        await User.updateMany({ fcmToken: f.token }, { $unset: { fcmToken: '' } });
        console.log(`Removed invalid token (first12): ${f.token.slice(0, 12)}... reason: ${f.reason}`);
      } catch (cleanupErr) {
        console.error('Error removing invalid token', f.token, cleanupErr);
      }
    }
  } else {
    console.log('No failed tokens reported that require cleanup.');
  }

  console.log(`Notification flow complete for task ${task._id}`);
  return { summary: sendSummary, failedTokens: failedTokensToCleanup };
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

    console.log('Task saved to DB:', { id: newTask._id.toString(), title: newTask.title, assignedTo: assignedArr });

    // WAIT for notification sending to log results immediately
    try {
      const notifyResult = await sendTaskAssignedNotifications(newTask, assignedArr);
      console.log('Notification send result for task', newTask._id.toString(), ':', JSON.stringify(notifyResult, null, 2));
    } catch (notifyErr) {
      console.error('Error while sending notifications for task', newTask._id.toString(), notifyErr);
    }

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

    console.log(`Saved device token for user ${req.user.id} (token start: ${fcmToken.slice(0,12)}...)`);
    return res.json({ msg: 'Token saved' });
  } catch (err) {
    console.error('POST /api/tasks/device-token error:', err);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
