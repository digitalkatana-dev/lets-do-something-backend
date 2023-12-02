const { Router } = require('express');
const { model } = require('mongoose');
const { sign } = require('jsonwebtoken');
const { genSalt, hash } = require('bcrypt');
const { createHash } = require('crypto');
const { config } = require('dotenv');
const {
	validateRegistration,
	validateLogin,
	validateForgot,
	validateReset,
	isEmail,
	isPhone,
} = require('../util/validators');
const requireAuth = require('../middleware/requireAuth');
const sgMail = require('@sendgrid/mail');

const User = model('User');
const router = Router();
config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Register
router.post('/users/register', async (req, res) => {
	const { valid, errors } = validateRegistration(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { email, phone } = req?.body;

	const user = await User.findOne({ $or: [{ email }, { phone }] });

	if (user) {
		if (email == user.email) {
			errors.email = 'Email already in use.';
		} else {
			errors.phone = 'Phone number already in use.';
		}
		return res.status(400).json(errors);
	}

	try {
		const newUser = new User(req?.body);
		await newUser?.save();
		const token = sign({ userId: newUser?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		const userData = {
			_id: newUser?._id,
			firstName: newUser?.firstName,
			lastName: newUser?.lastName,
			phone: newUser?.phone,
			email: newUser?.email,
			notify: newUser?.notify,
			profilePic: newUser?.profilePic,
			coverPhoto: newUser?.coverPhoto,
			isAdmin: newUser?.isAdmin,
			myEvents: newUser?.myEvents,
			eventsAttending: newUser?.eventsAttending,
			friends: newUser?.friends,
		};

		res.json({ userData, token });
	} catch (err) {
		console.log(err);
		errors.message = 'Error registering user!';
		return res.status(422).json(errors);
	}
});

// Login
router.post('/users/login', async (req, res) => {
	const { valid, errors } = validateLogin(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { login, password } = req?.body;

	const user = await User.findOne({
		$or: [{ phone: login }, { email: login }],
	})
		.populate('friends')
		.populate('myEvents')
		.populate('eventsAttending');
	if (!user) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		await user?.comparePassword(password);
		const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		const userData = {
			_id: user?._id,
			firstName: user?.firstName,
			lastName: user?.lastName,
			phone: user?.phone,
			email: user?.email,
			notify: user?.notify,
			profilePic: user?.profilePic,
			coverPhoto: user?.coverPhoto,
			isAdmin: user?.isAdmin,
			friends: user?.friends,
			myEvents: user?.myEvents,
			eventsAttending: user?.eventsAttending,
		};

		res.json({ userData, token });
	} catch (err) {
		errors.message = 'Invalid email or password!';
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
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		const resetToken = user?.createPasswordResetToken();
		await user?.save();

		const resetUrl = `<h3>We've received a request to reset your password!</h3> \n <p>Hi ${email}, we received a password reset request from your account. To complete the reset, please <a href='http://localhost:3000/reset-password/${resetToken}'>click here.</a> The link is valid for 10 minutes.</p> \n <p>If this was not intended or you have questions about your account, please contact support@letsdosomething.net right away.</p>`;
		const msg = {
			to: email,
			from: process.env.SG_BASE_EMAIL,
			subject: 'Reset Your Password',
			html: resetUrl,
		};

		await sgMail.send(msg);
		res.json({
			message: `A password reset link has been sent to ${user?.email}. The link is valid for 10 minutes.`,
		});
	} catch (err) {
		errors.message = 'Error generating token';
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
		errors.message = 'Token expired, try again later.';
		return res.status(400).json(errors);
	}

	try {
		user.password = password;
		user.passwordResetToken = undefined;
		user.passwordResetTokenExpires = undefined;
		await user?.save();

		const successMessage = `<h3>Password Change Notification</h3> <p>This e-mail confirms that the password has been changed for your account.</p> <p>If you did not intend to change your password, please contact support@letsdosomething.net right away.</p> `;
		const msg = {
			to: user?.email,
			from: process.env.SG_BASE_EMAIL,
			subject: 'Your Password Has Been Updated',
			html: successMessage,
		};

		await sgMail.send(msg);
		res.json({ message: 'Password Upated Successfully!' });
	} catch (err) {
		errors.message = 'Error verifing token.';
		return res.status(400).json(errors);
	}
});

// Get User(s)
router.get('/users', requireAuth, async (req, res) => {
	let errors = {};
	const hasId = req?.query?.id;
	let users;
	let userData;

	try {
		if (hasId) {
			users = await User.findById(hasId)
				.populate('friends')
				.populate('myEvents')
				.populate('eventsAttending');
			userData = {
				_id: users?._id,
				firstName: users?.firstName,
				lastName: users?.lastName,
				phone: users?.phone,
				email: users?.email,
				notify: users?.notify,
				profilePic: users?.profilePic,
				coverPhoto: users?.coverPhoto,
				isAdmin: users?.isAdmin,
				myEvents: users?.myEvents,
				eventsAttending: users?.eventsAttending,
				friends: users?.friends,
			};
		} else {
			users = await User.find({})
				.populate('friends')
				.populate('myEvents')
				.populate('eventsAttending');
			users.forEach((user) => {
				userData.push({
					_id: user?._id,
					firstName: user?.firstName,
					lastName: user?.lastName,
					phone: user?.phone,
					email: user?.email,
					notify: user?.notify,
					profilePic: user?.profilePic,
					coverPhoto: user?.coverPhoto,
					isAdmin: user?.isAdmin,
					myEvents: user?.myEvents,
					eventsAttending: user?.eventsAttending,
					friends: user?.friends,
				});
			});
		}

		res.json(userData);
	} catch (err) {
		errors.message = 'Error getting users';
		return res.status(400).json(errors);
	}
});

// Find 1
router.post('/users/find', requireAuth, async (req, res) => {
	let errors = {};
	let user;
	let userData;

	const { guest } = req?.body;

	try {
		if (isEmail(guest)) {
			user = await User.findOne({ email: guest });

			if (user) {
				userData = {
					_id: user?._id,
					firstName: user?.firstName,
					lastName: user?.lastName,
					phone: user?.phone,
					email: user?.email,
					notify: user?.notify,
					...(user.profilePic && { profilePic: user?.profilePic }),
				};
			} else {
				userData = {
					_id: guest,
					email: guest,
					notify: 'email',
				};
			}
		} else if (isPhone(guest)) {
			user = await User.findOne({ phone: guest });

			if (user) {
				userData = {
					_id: user?._id,
					firstName: user?.firstName,
					lastName: user?.lastName,
					phone: user?.phone,
					email: user?.email,
					notify: user?.notify,
					...(user.profilePic && { profilePic: user?.profilePic }),
				};
			} else {
				userData = {
					_id: guest,
					phone: guest,
					notify: 'sms',
				};
			}
		}

		res.json(userData);
	} catch (err) {
		errors.message = 'Error searching for user';
		return res.status(400).json(errors);
	}
});

// Update
router.put('/users/:id/update', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		if (req?.body?.password) {
			const salt = await genSalt(10);
			req.body.password = await hash(req?.body?.password, salt);
		}

		const updated = await User.findByIdAndUpdate(
			id,
			{
				$set: req?.body,
			},
			{
				new: true,
			}
		)
			.populate('friends')
			.populate('myEvents')
			.populate('eventsAttending');

		if (!updated) {
			errors.message = 'Error, user not found!';
			return res.status(404).json(errors);
		}

		const userData = {
			_id: updated?._id,
			firstName: updated?.firstName,
			lastName: updated?.lastName,
			phone: updated?.phone,
			email: updated?.email,
			notify: updated?.notify,
			profilePic: updated?.profilePic,
			coverPhoto: updated?.coverPhoto,
			isAdmin: updated?.isAdmin,
			friends: updated?.friends,
			myEvents: updated?.myEvents,
			eventsAttending: updated?.eventsAttending,
		};

		res.json({ userData, success: { message: 'User updated successfully!' } });
	} catch (err) {
		console.log(err);
		errors.message = 'Error updating user!';
		return res.status(400).json(errors);
	}
});

// Add/Remove Friend
router.put('/users/:id/friends', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	const user = req?.user;
	const friend = await User.findById(id);
	if (!friend) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	const friends = user.friends;
	const areFriends = friends.includes(id);
	const option = areFriends ? '$pull' : '$push';

	try {
		await User.findByIdAndUpdate(
			user?._id,
			{ [option]: { friends: id } },
			{ new: true }
		);

		res.json({ message: 'Friend added/removed successfully!' });
	} catch (err) {
		console.log(err);
		errors.message = 'Error adding/removing friend!';
		return res.status(400).json(errors);
	}
});

// Delete User
router.delete('/users/:id', requireAuth, async (req, res) => {
	const errors = {};
	const { id } = req?.params;

	try {
		const deleted = await User.findByIdAndDelete(id);

		if (!deleted) {
			errors.message = 'Error, user not found!';
			return res.status(404).json(errors);
		}

		res.json({ deleted, success: { message: 'User deleted successfully!' } });
	} catch (err) {
		console.log(err);
		errors.message = 'Error deleting user!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
