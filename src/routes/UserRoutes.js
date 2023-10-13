const { Router } = require('express');
const { model } = require('mongoose');
const { sign } = require('jsonwebtoken');
const { genSalt, hash } = require('bcrypt');
const { createHash } = require('crypto');
const { config } = require('dotenv');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
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
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
	secure: true,
});

// Register
router.post('/users/register', async (req, res) => {
	let userData;

	const { valid, errors } = validateRegistration(req?.body);

	if (!valid) return res.status(400).json(errors);

	try {
		const user = new User(req?.body);
		await user?.save();
		const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		userData = {
			_id: user?._id,
			firstName: user?.firstName,
			lastName: user?.lastName,
			phone: user?.phone,
			email: user?.email,
			notify: user?.notify,
			isAdmin: user?.isAdmin,
			myEvents: user?.myEvents,
			eventsAttending: user?.eventsAttending,
			friends: user?.friends,
		};

		res.json({ userData, token });
	} catch (err) {
		if (err.code === 11000) {
			if (err.keyValue.email) errors.message = 'Email already in use!';
			if (err.keyValue.phone) errors.message = 'Phone number already in use!';
		} else {
			errors.message = 'Error registering user!';
		}
		return res.status(422).json(errors);
	}
});

// Login
router.post('/users/login', async (req, res) => {
	const { email, password } = req?.body;
	let userData;

	const { valid, errors } = validateLogin(req?.body);

	if (!valid) return res.status(400).json(errors);

	const user = await User.findOne({ email });
	if (!user) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		await user?.comparePassword(password);
		const token = sign({ userId: user?._id }, process.env.DB_SECRET_KEY, {
			expiresIn: '10d',
		});

		userData = {
			_id: user?._id,
			firstName: user?.firstName,
			lastName: user?.lastName,
			phone: user?.phone,
			email: user?.email,
			notify: user?.notify,
			...(user.profilePic && { profilePic: user?.profilePic }),
			isAdmin: user?.isAdmin,
			myEvents: user?.myEvents,
			eventsAttending: user?.eventsAttending,
			friends: user?.friends,
		};

		res.json({ userData, token });
	} catch (err) {
		errors.message = 'Invalid email or password!';
		return res.status(400).json(errors);
	}
});

// Generate Password Reset Token
router.post('/users/generate-password-token', async (req, res) => {
	const { email } = req?.body;

	const { valid, errors } = validateForgot(req?.body);

	if (!valid) return res.status(400).json(errors);

	const user = await User.findOne({ email });

	if (!user) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		const resetToken = user?.createPasswordResetToken();
		await user?.save();

		const resetUrl = `<h3>We've received a request to reset your password!</h3> \n <p>Hi ${email}, we received a password reset request from your account. To complete the reset, please <a href='https://letsdosomething.net/reset-password/${resetToken}'>click here.</a> The link is valid for 10 minutes.</p> \n <p>If this was not intended or you have questions about your account, please contact support@letsdosomething.net right away.</p>`;
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
	const { password, token } = req?.body;

	const { valid, errors } = validateReset(req?.body);

	if (!valid) return res.status(400).json(errors);

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

// Get All
router.get('/users', requireAuth, async (req, res) => {
	let errors = {};
	let userData = [];

	try {
		const users = await User.find({});
		users.forEach((user) => {
			userData.push({
				_id: user?._id,
				firstName: user?.firstName,
				lastName: user?.lastName,
				phone: user?.phone,
				email: user?.email,
				notify: user?.notify,
				...(user.profilePic && { profilePic: user?.profilePic }),
				isAdmin: user?.isAdmin,
				myEvents: user?.myEvents,
				eventsAttending: user?.eventsAttending,
				friends: user?.friends,
			});
		});

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

				res.json(userData);
			} else {
				userData = {
					_id: guest,
					email: guest,
					notify: 'email',
				};
				res.json(userData);
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

				res.json(userData);
			} else {
				userData = {
					_id: guest,
					phone: guest,
					notify: 'sms',
				};
				res.json(userData);
			}
		}
	} catch (err) {
		errors.message = 'Error searching for user';
		return res.status(400).json(errors);
	}
});

// Get 1
router.get('/users/:id', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const user = await User.findById(id);

		if (!user) {
			errors.message = 'Error, user not found!';
			return res.status(404).json(errors);
		}

		const userData = {
			_id: user?._id,
			firstName: user?.firstName,
			lastName: user?.lastName,
			phone: user?.phone,
			email: user?.email,
			notify: user?.notify,
			...(user.profilePic && { profilePic: user?.profilePic }),
			isAdmin: user?.isAdmin,
			myEvents: user?.myEvents,
			eventsAttending: user?.eventsAttending,
			friends: user?.friends,
		};

		res.json(userData);
	} catch (err) {
		errors.message = 'Error getting user';
		return res.status(400).json(errors);
	}
});

// Update Profile Pic
const storage = multer.memoryStorage();
const filter = (req, file, cb) => {
	file.mimetype.startsWith('image')
		? cb(null, true)
		: cb({ message: 'Unsupported file format.' }, false);
};
const upload = multer({
	storage: storage,
	fileFilter: filter,
	limits: { fileSize: 5000000, fieldSize: 25 * 1024 * 1024 },
});

const cloudinaryUpload = async (fileToUpload) => {
	const options = {
		use_filename: true,
		unique_filename: false,
		overwrite: true,
		resource_type: 'auto',
	};

	try {
		const data = await cloudinary.uploader.upload(fileToUpload, options);
		return { url: data?.secure_url };
	} catch (err) {
		console.error(err);
	}
};

router.post(
	'/users/profile-pic',
	requireAuth,
	upload.single('file'),
	async (req, res) => {
		let errors = {};
		let userData;

		const { b64str } = req?.body;

		try {
			const image = await cloudinaryUpload(b64str);
			const updated = await User.findByIdAndUpdate(
				req?.user?._id,
				{
					$set: {
						profilePic: image?.url,
					},
				},
				{
					new: true,
				}
			);

			userData = {
				_id: updated?._id,
				firstName: updated?.firstName,
				lastName: updated?.lastName,
				phone: updated?.phone,
				email: updated?.email,
				notify: updated?.notify,
				profilePic: updated?.profilePic,
				isAdmin: updated?.isAdmin,
				myEvents: updated?.myEvents,
				eventsAttending: updated?.eventsAttending,
				friends: updated?.friends,
			};

			res.json(userData);
		} catch (err) {
			errors.message = 'Error updating profile pic!';
			console.log('Profile Pic Error:', err);
			return res.status(400).json(errors);
		}
	}
);

// Update
router.put('/users/update', requireAuth, async (req, res) => {
	const { _id } = req?.user;
	let userData;

	const user = await User.findById(_id);

	if (!user) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		if (req?.body?.password) {
			const salt = await genSalt(10);
			req.body.password = await hash(req?.body?.password, salt);
		}

		const updated = await User.findByIdAndUpdate(
			_id,
			{
				$set: req?.body,
			},
			{
				new: true,
				runValidators: true,
			}
		);

		userData = {
			_id: updated?._id,
			firstName: updated?.firstName,
			lastName: updated?.lastName,
			phone: updated?.phone,
			email: updated?.email,
			notify: updated?.notify,
			...(updated.profilePic && { profilePic: updated?.profilePic }),
			isAdmin: updated?.isAdmin,
			myEvents: updated?.myEvents,
			eventsAttending: updated?.eventsAttending,
			friends: updated?.friends,
		};

		res.json({ userData, success: { message: 'User updated successfully!' } });
	} catch (err) {
		errors.message = 'Error updating user!';
		return res.status(400).json(errors);
	}
});

// Delete User
router.delete('/users/:id', requireAuth, async (req, res) => {
	const errors = {};
	const { id } = req?.params;

	const user = await User.findById(id);

	if (!user) {
		errors.message = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	try {
		await User.findByIdAndDelete(id);
		res.json({ message: 'User deleted successfully!' });
	} catch (err) {
		errors.message = 'Error deleting user!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
