const { Router } = require('express');
const { model } = require('mongoose');
const requireAuth = require('../middleware/requireAuth');

const Notification = model('Notification');
const router = Router();

// Create
router.post('/notifications', requireAuth, async (req, res) => {});

// Read
router.get('/notifications', requireAuth, async (req, res) => {
	let errors = {};
	let myNotifications;

	const unopenedOnly = req?.query?.unopened;

	try {
		if (unopenedOnly) {
			myNotifications = await Notification.find({
				userTo: req?.user?._id,
				notificationType: { $ne: 'newMessage' },
				opened: false,
			})
				.populate('userTo')
				.populate('userFrom')
				.sort('createdAt');
		} else {
			myNotifications = await Notification.find({
				userTo: req?.user?._id,
				notificationType: { $ne: 'newMessage' },
			})
				.populate('userTo')
				.populate('userFrom')
				.sort('createdAt');
		}

		if (!myNotifications) {
			errors.message = 'Error, notifications not found!';
			return res.status(404).json(errors);
		}

		myNotifications.forEach((item) => {
			item.userFrom = {
				_id: item.userFrom._id,
				firstName: item.userFrom.firstName,
				lastName: item.userFrom.lastName,
				profilePic: item.userFrom.profilePic,
			};
		});

		res.json({
			myNotifications,
			success: { message: 'Notifications retrieved  successfully!' },
		});
	} catch (err) {
		console.log(err);
		errors.message = 'Error getting notifications!';
		return res.status(400).json(errors);
	}
});

// Get Latest
router.get('/notifications/latest', requireAuth, async (req, res) => {
	let errors = {};

	try {
		const latest = await Notification.findOne({
			userTo: req?.user?._id,
		})
			.populate('userTo')
			.populate('userFrom');

		if (!latest) {
			errors.message = 'Error, notification not found!';
			return res.status(404).json(errors);
		}

		latest.userFrom = {
			_id: latest.userFrom._id,
			firstName: latest.userFrom.firstName,
			lastName: latest.userFrom.lastName,
			profilePic: latest.userFrom.profilePic,
		};

		res.json({
			latest,
			success: { message: 'Retrieved latest notification successfully!' },
		});
	} catch (err) {
		console.log(err);
		errors.message = 'Error getting latest notification!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
