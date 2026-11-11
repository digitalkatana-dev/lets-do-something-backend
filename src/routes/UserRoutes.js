const { Router } = require('express');
const { model } = require('mongoose');
const { sign } = require('jsonwebtoken');
const { createHash } = require('crypto');
// const { config } = require('dotenv');
const {
  validateAuth,
  validateForgot,
  validateReset,
} = require('../util/validators');
const {
  loginLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimit');
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const User = model('User');
const Profile = model('Profile');
const router = Router();
// config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

// Register
router.post('/api/users/register', async (req, res) => {
  const { valid, errors } = validateAuth(req?.body);

  if (!valid) return res.status(400).json(errors);

  try {
    const { email, password } = req?.body;
    const user = await User.findOne({ email });

    if (user) {
      errors.email = 'Email already in use!';
      return res.status(400).json(errors);
    }

    const newUserData = {
      email,
      password,
    };

    newUser = new User(newUserData);
    await newUser?.save();

    const newProfileData = {
      email,
      user: newUser?._id,
    };

    const newProfile = new Profile(newProfileData);
    await newProfile?.save();

    const userProfileRaw = await User.findOne({ email }).populate('profile');
    const userProfile = userProfileRaw?.profile;

    const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
      expiresIn: '5d',
    });

    res.json({
      success: 'Registration successful!',
      userProfile,
      token,
    });
  } catch (err) {
    console.log('Signin Error: ', err);
    errors.register = 'Something went wrong! Please try again.';
    return res.status(500).json(errors);
  }
});

// Login
router.post('/api/users/login', loginLimiter, async (req, res) => {
  const { valid, errors } = validateAuth(req?.body);

  if (!valid) return res.status(400).json(errors);

  try {
    const { email, password } = req?.body;
    const user = await User.findOne({ email })
      .populate('profile')
      .populate({ path: 'profile', populate: { path: 'friends' } })
      .populate({ path: 'profile', populate: { path: 'myEvents' } })
      .populate({
        path: 'profile',
        populate: { path: 'myEvents', populate: { path: 'createdBy' } },
      })
      .populate({ path: 'profile', populate: { path: 'eventsAttending' } })
      .populate({
        path: 'profile',
        populate: { path: 'eventsAttending', populate: { path: 'createdBy' } },
      })
      .populate({ path: 'profile', populate: { path: 'myMemories' } });

    if (!user) {
      errors.user = 'Error, user not found!';
      return res.status(400).json(errors);
    }

    await user?.comparePassword(password);

    const userProfile = user?.profile;

    const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
      expiresIn: '5d',
    });

    res.json({
      success: 'Login successful!',
      userProfile,
      token,
    });
  } catch (err) {
    console.log('Login Error: ', err);
    errors.login = 'Something went wrong! Please try again.';
    return res.status(500).json(errors);
  }
});

// Generate Password Reset Token
router.put(
  '/api/users/generate-password-token',
  passwordResetLimiter,
  async (req, res) => {
    const { valid, errors } = validateForgot(req?.body);

    if (!valid) return res.status(400).json(errors);

    try {
      const { email } = req?.body;
      const genericMessage = `If an account exists for ${email}, a password reset link has been sent. The link is valid for 10 minutes.`;

      const user = await User.findOne({ email });

      if (!user) {
        errors.user = 'Error, user not found!';
        return res.status(404).json(errors);
      }

      const resetToken = user?.createPasswordResetToken();
      await user?.save();

      let resetUrl = fs.readFileSync(
        path.join(__dirname, '..', 'emails', 'reset-token.html'),
        'utf-8',
      );
      resetUrl = resetUrl.replace('{{email}}', email);
      resetUrl = resetUrl.replace('{{resetToken}}', resetToken);

      const msg = {
        to: email,
        from: process.env.SG_BASE_EMAIL,
        subject: 'Reset Your Password',
        html: resetUrl,
      };

      await sgMail.send(msg);
      res.json(genericMessage);
    } catch (err) {
      console.log('Generate Token Error: ', err);
      errors.token = 'Something went wrong! Please try again.';
      return res.status(500).json(errors);
    }
  },
);

// Password Reset
router.put('/api/users/reset-password', async (req, res) => {
  const { valid, errors } = validateReset(req?.body);

  if (!valid) return res.status(400).json(errors);

  try {
    const { password, token } = req?.body;

    const hashedToken = createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      errors.token = 'Token expired, try again later.';
      return res.status(400).json(errors);
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpires = undefined;
    await user.save();

    const resetSuccess = fs.readFileSync(
      path.join(__dirname, '..', 'emails', 'password-reset.html'),
      'utf-8',
    );

    const msg = {
      to: user?.email,
      from: process.env.SG_BASE_EMAIL,
      subject: 'Your Password Has Been Updated',
      html: resetSuccess,
    };

    await sgMail.send(msg);
    res.json('Password Updated Successfully!');
  } catch (err) {
    console.log('Reset error', err);
    errors.reset = 'Error verifing token.';
    return res.status(400).json(errors);
  }
});

module.exports = router;
