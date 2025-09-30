const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  // Extract token from header
  const token = req.header('Authorization') 
    ? req.header('Authorization').split(' ')[1] 
    : null;

  // Log the token for debugging
  console.log('JWT Token:', token);

  if (!token) return res.status(401).json({ msg: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token is not valid' });
  }
};
