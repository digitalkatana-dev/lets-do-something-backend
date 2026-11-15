const { verify } = require('jsonwebtoken');
const { model } = require('mongoose');
const User = model('User');
const Profile = model('Profile');

// Sets req.user (auth account) and req.profile (role, name, ownership id).
module.exports = async (req, res, next) => {
  try {
    const { authorization } = req?.headers;
    if (!authorization) return res.status(401).json('You must be logged in.');

    const token = authorization.replace('Bearer ', '');
    if (!token) return res.status(401).json('You must be logged in.');

    let payload;
    try {
      payload = verify(token, process.env.DB_SECRET_KEY);
    } catch (err) {
      // Bad or expired token
      return res.status(401).json('You must be logged in.');
    }

    const user = payload?.userId
      ? await User.findById(payload.userId).select('-password')
      : null;
    if (!user) return res.status(401).json('You must be logged in.');

    const profile = await Profile.findOne({ user: user._id });
    if (!profile) return res.status(401).json('You must be logged in.');

    req.user = user;
    req.profile = profile;
    next();
  } catch (err) {
    console.log('Auth Error', err);
    return res.status(500).json('Something went wrong! Please try again.');
  }
};
