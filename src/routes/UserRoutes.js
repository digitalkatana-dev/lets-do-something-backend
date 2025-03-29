const { Router } = require('express');
const { model } = require('mongoose');
const { sign } = require('jsonwebtoken');
const { createHash } = require('crypto');
const { config } = require('dotenv');
const {
	validateRegistration,
	validateLogin,
	validateForgot,
	validateReset,
} = require('../util/validators');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');

const User = model('User');
const Profile = model('Profile');
const router = Router();
config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Register
router.post('/users/register', async (req, res) => {
	const { valid, errors } = validateRegistration(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { firstName, lastName, email, phone, password, notify } = req?.body;

	const user = await User.findOne({ email });

	if (user) {
		if (email == user?.email) {
			errors.email = 'Email already in use.';
			return res.status(400).json(errors);
		}
	}

	try {
		const newUserData = {
			email,
			password,
		};

		const newUser = new User(newUserData);
		await newUser?.save();

		const newProfileData = {
			firstName,
			lastName,
			phone,
			email,
			notify,
			user: newUser?._id,
		};

		const userProfile = new Profile(newProfileData);
		await userProfile?.save();

		const token = sign({ userId: newUser?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		res.json({ userData: userProfile, token });
	} catch (err) {
		console.log(err);
		errors.users = 'Error registering user!';
		return res.status(422).json(errors);
	}
});

// Login
router.post('/users/login', async (req, res) => {
	const { valid, errors } = validateLogin(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { email, password } = req?.body;

	try {
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
			});

		if (!user) {
			errors.users = 'Error, user not found!';
			return res.status(404).json(errors);
		}

		await user?.comparePassword(password);
		const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		res.json({ userData: user.profile, token });
	} catch (err) {
		errors.users = 'Invalid email or password!';
		return res.status(400).json(errors);
	}
});

// Generate Password Reset Token
router.post('/users/generate-password-token', async (req, res) => {
	const { valid, errors } = validateForgot(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { email } = req?.body;

	const user = await User.findOne({ email });

	if (!user) {
		errors.token = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		const resetToken = user?.createPasswordResetToken();
		await user?.save();

		let resetUrl = fs.readFileSync('src/emails/reset-token.html', 'utf-8');
		resetUrl = resetUrl.replace('{{email}}', email);
		resetUrl = resetUrl.replace('{{resetToken}}', resetToken);

		const msg = {
			to: email,
			from: process.env.SG_BASE_EMAIL,
			subject: 'Reset Your Password',
			html: resetUrl,
		};

		await sgMail.send(msg);
		res.json(
			`A password reset link has been sent to ${user?.email}. The link is valid for 10 minutes.`
		);
	} catch (err) {
		errors.token = 'Error generating token';
		return res.status(400).json(errors);
	}
});

// Password Reset
router.post('/users/reset-password', async (req, res) => {
	const { valid, errors } = validateReset(req?.body);

	if (!valid) return res.status(400).json(errors);

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

	try {
		user.password = password;
		user.passwordResetToken = undefined;
		user.passwordResetTokenExpires = undefined;
		await user?.save();

		const resetSuccess = fs.readFileSync(
			'src/emails/password-reset.html',
			'utf-8'
		);

		const msg = {
			to: user?.email,
			from: process.env.SG_BASE_EMAIL,
			subject: 'Your Password Has Been Updated',
			html: resetSuccess,
		};

		await sgMail.send(msg);
		res.json('Password Upated Successfully!');
	} catch (err) {
		errors.token = 'Error verifing token.';
		return res.status(400).json(errors);
	}
});

module.exports = router;
