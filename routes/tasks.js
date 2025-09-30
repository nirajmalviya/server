// routes/tasks.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');
// add this to top of routes/tasks.js (below other requires)
const notificationService = require('../service/notificationService');
// notificationService should export: getAccessToken and sendNotificationToUser (as in your snippet)


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
// Replace the old sendTaskAssignedNotifications function with this one:

async function sendTaskAssignedNotifications(task, assignedUserIds = []) {
  console.log(`Notification flow start for task ${task._id} (title: "${task.title}")`);
  if (!Array.isArray(assignedUserIds) || assignedUserIds.length === 0) {
    console.log('No assigned users, skipping notifications.');
    return { sent: 0, failed: 0, details: [] };
  }

  try {
    // 1) Fetch users and tokens from DB
    console.log('Fetching users from DB for assignedUserIds:', assignedUserIds);
    const users = await User.find({ _id: { $in: assignedUserIds } }).select('fcmTokens fcmToken username name');
    console.log(`Fetched ${users.length} users from DB.`);

    // 2) For each user, call your notificationService.sendNotificationToUser to perform sending
    const allResults = [];
    for (const u of users) {
      const uid = u._id.toString();
      console.log(`Preparing to send notification to user ${uid} (${u.username || u.name || '<no-username>'})`);
      try {
        // sendNotificationToUser (your helper) will fetch tokens from DB and call FCM (it logs too)
        const results = await notificationService.sendNotificationToUserFromDb(uid, `New Task: ${task.title}`, task.description || '');
        console.log(`sendNotificationToUser returned for user ${uid}:`, JSON.stringify(results, null, 2));

        // results is an array of per-token send results { token, status, data|error }
        allResults.push({ userId: uid, ok: true, results });
      } catch (sendErr) {
        console.error(`Error sending notifications to user ${uid}:`, sendErr && (sendErr.message || sendErr));
        // If sendNotificationToUser throws, include that in results
        allResults.push({ userId: uid, ok: false, error: (sendErr && sendErr.message) || sendErr });
      }
    }

    // 3) Analyze results to detect failed tokens and clean them
    const failedTokens = [];
    allResults.forEach(uRes => {
      if (uRes.ok && Array.isArray(uRes.results)) {
        uRes.results.forEach(r => {
          if (r.status !== 'sent') {
            // either your sendNotificationToUser pushed { status: 'failed', error: '...' }
            failedTokens.push({ token: r.token, userId: uRes.userId, reason: r.error || 'unknown' });
          } else if (r.data && r.data.error) {
            // in case your send returns an FCM error inside data
            failedTokens.push({ token: r.token, userId: uRes.userId, reason: JSON.stringify(r.data) });
          }
        });
      }
    });

    if (failedTokens.length > 0) {
      console.log('Cleaning up failed tokens:', JSON.stringify(failedTokens, null, 2));
      for (const f of failedTokens) {
        try {
          // remove token from any fcmTokens arrays and clear legacy fcmToken fields
          await User.updateMany({ 'fcmTokens.token': f.token }, { $pull: { fcmTokens: { token: f.token } } });
          await User.updateMany({ fcmToken: f.token }, { $unset: { fcmToken: '' } });
          console.log(`Removed invalid token for user ${f.userId} token (first12): ${f.token.slice(0,12)}... reason: ${f.reason}`);
        } catch (cleanupErr) {
          console.error('Error removing invalid token', f.token, cleanupErr);
        }
      }
    } else {
      console.log('No failed tokens returned by FCM.');
    }

    console.log(`Notification flow complete for task ${task._id}`);
    return { sentSummary: allResults, failedTokens };
  } catch (err) {
    console.error('Unexpected error in sendTaskAssignedNotifications:', err);
    throw err;
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
 console.log('Task saved to DB:', { id: newTask._id.toString(), title: newTask.title, assignedTo: assignedArr });
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

    return res.json({ msg: 'Token saved' });
  } catch (err) {
    console.error('POST /api/tasks/device-token error:', err);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
