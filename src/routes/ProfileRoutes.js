const { Router } = require('express');
const { model, isValidObjectId } = require('mongoose');
const { config } = require('dotenv');
const { isEmail, isPhone } = require('../util/validators');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');
const dayjs = require('dayjs');
const requireAuth = require('../middleware/requireAuth');
const Profile = model('Profile');
const User = model('User');
const Event = model('Event');
const router = Router();
config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const twilioClient = require('twilio')(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN
);

// Get Profile(s)
router.get('/profiles', requireAuth, async (req, res) => {
	let errors = {};
	const hasId = req?.query?.id;
	const hasSearch = req?.query?.search;
	let userData;

	try {
		if (hasId) {
			userData = await Profile.findById(hasId)
				.populate('friends')
				.populate('myEvents')
				.populate({ path: 'myEvents', populate: { path: 'createdBy' } })
				.populate('eventsAttending')
				.populate({ path: 'eventsAttending', populate: { path: 'createdBy' } });
		} else if (hasSearch) {
			userData = await Profile.find({
				$and: [
					{
						$or: [
							{ firstName: { $regex: hasSearch, $options: 'i' } },
							{ lastName: { $regex: hasSearch, $options: 'i' } },
						],
					},
					{
						user: { $ne: req?.user?._id },
					},
				],
			})
				.populate('friends')
				.populate('myEvents')
				.populate({ path: 'myEvents', populate: { path: 'createdBy' } })
				.populate('eventsAttending')
				.populate({ path: 'eventsAttending', populate: { path: 'createdBy' } });
		} else {
			userData = await Profile.find({})
				.populate('friends')
				.populate('myEvents')
				.populate({ path: 'myEvents', populate: { path: 'createdBy' } })
				.populate('eventsAttending')
				.populate({ path: 'eventsAttending', populate: { path: 'createdBy' } });
		}

		res.json(userData);
	} catch (err) {
		errors.profiles = 'Error getting users!';
		return res.status(400).json(errors);
	}
});

// Find 1
router.post('/profiles/verify', requireAuth, async (req, res) => {
	let errors = {};
	let user;
	let userData;

	const { guest } = req?.body;

	try {
		if (isEmail(guest)) {
			user = await Profile.findOne({ email: guest });

			if (user) {
				userData = user;
			} else {
				userData = {
					_id: guest,
					email: guest,
					notify: 'email',
				};
			}
		} else if (isPhone(guest)) {
			user = await Profile.findOne({ phone: guest });

			if (user) {
				userData = user;
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
		errors.profiles = 'Error searching for user!';
		return res.status(400).json(errors);
	}
});

// Update Profile
router.put('/profiles/:id/update', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const updated = await Profile.findByIdAndUpdate(
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
			.populate({ path: 'myEvents', populate: { path: 'createdBy' } })
			.populate('eventsAttending')
			.populate({ path: 'eventsAttending', populate: { path: 'createdBy' } });

		if (!updated) {
			errors.profiles = 'Error, user not found!';
			return res.status(404).json(errors);
		}

		res.json({ updated, success: 'User updated successfully!' });
	} catch (err) {
		errors.profiles = 'Error updating user!';
		return res.status(400).json(errors);
	}
});

// Add/Remove Friend
router.put('/profiles/:id/friends', requireAuth, async (req, res) => {
	let errors = {};
	let { id } = req?.params;

	const user = await Profile.findOne({ user: req?.user?._id });
	const friend = await Profile.findById(id);

	if (!friend) {
		errors.profiles = 'Error, user not found!';
		return res.status(404).json(errors);
	}

	const friends = user.friends;
	const areFriends = friends?.includes(id);
	const option = areFriends ? '$pull' : '$push';

	try {
		const updated = await Profile.findByIdAndUpdate(
			user?._id,
			{
				[option]: { friends: id },
			},
			{
				new: true,
			}
		)
			.populate('friends')
			.populate('myEvents')
			.populate({ path: 'myEvents', populate: { path: 'createdBy' } })
			.populate('eventsAttending')
			.populate({ path: 'eventsAttending', populate: { path: 'createdBy' } });

		res.json({
			updated,
			success: 'Friend added/removed successfully!',
		});
	} catch (err) {
		errors.profiles = 'Error adding/removing friend!';
		return res.status(400).json(errors);
	}
});

// Find And Invite
router.post('/profiles/find-and-invite', requireAuth, async (req, res) => {
	let errors = {};

	const { guest, eventId, type, date, time, notes } = req?.body;

	try {
		const event = await Event.findById(eventId);
		const invited = event.invitedGuests;
		const isInvited = invited.some(
			(item) => guest == item._id || guest == item.email || guest == item.phone
		);
		const option = isInvited ? '$pull' : '$push';
		const successMessage =
			option === '$pull'
				? 'Guest removed successfully!'
				: 'Guest invited successfully!';
		const activeUser = await Profile.findOne({ user: req?.user?._id });
		const host = activeUser?.firstName + ' ' + activeUser?.lastName;
		let user;
		let userData;
		let subject;
		let smsMessage;
		let emailOpener;

		if (type === 'Party') {
			subject = `You've been invited to a ${type}!`;
			smsMessage = `You've been invited to a ${type} on ${date} at ${dayjs(
				time
			).format(
				'h:mm a'
			)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
			emailOpener = `You've been invited to a ${type} on ${date} at ${dayjs(
				time
			).format('h:mm a')} by ${host}.`;
		} else if (type === 'Movies') {
			subject = `You've been invited to the ${type}!`;
			smsMessage = `You've been invited to the ${type} on ${date} at ${dayjs(
				time
			).format(
				'h:mm a'
			)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
			emailOpener = `You've been invited to the ${type} on ${date} at ${dayjs(
				time
			).format('h:mm a')} by ${host}.`;
		} else {
			subject = `You've been invited to ${type}!`;
			smsMessage = `You've been invited to ${type} on ${date} at ${dayjs(
				time
			).format(
				'h:mm a'
			)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
			emailOpener = `You've been invited to ${type} on ${date} at ${dayjs(
				time
			).format('h:mm a')} by ${host}.`;
		}

		if (isEmail(guest)) {
			user = await Profile.findOne({ email: guest });

			if (user) {
				userData = user;
			} else {
				userData = {
					_id: guest,
					email: guest,
					notify: 'email',
				};
			}
		} else if (isPhone(guest)) {
			user = await Profile.findOne({ phone: guest });

			if (user) {
				userData = user;
			} else {
				userData = {
					_id: guest,
					phone: guest,
					notify: 'sms',
				};
			}
		} else if (isValidObjectId(guest)) {
			userData = await Profile.findById(guest);
		}

		const updated = await Event.findByIdAndUpdate(
			eventId,
			{
				[option]: { invitedGuests: userData },
			},
			{
				new: true,
			}
		).populate('createdBy');

		if (option === '$push') {
			if (userData.notify === 'sms') {
				await twilioClient.messages.create({
					body: smsMessage,
					from: process.env.TWILIO_NUMBER,
					to: `+1${userData.phone}`,
				});
			} else if (userData.notify === 'email') {
				let invitation = fs.readFileSync('src/emails/invitation.html', 'utf-8');
				invitation = invitation.replace('{{emailOpener}}', emailOpener);
				invitation = invitation.replace('{{notes}}', notes);
				invitation = invitation.replace('{{label}}', updated.label);

				const msg = {
					to: userData.email,
					from: process.env.SG_BASE_EMAIL,
					subject: subject,
					html: invitation,
				};

				await sgMail.send(msg);
			}
		}

		res.json({
			updated,
			success: successMessage,
		});
	} catch (err) {
		errors.profiles = 'Error sending invite!';
		console.log('Invite Error:', err);
		return res.status(400).json(errors);
	}
});

// Delete User
router.delete('/profiles/:id/delete', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const deletedProfile = await Profile.findByIdAndDelete(id);

		if (!deletedProfile) {
			errors.profiles = 'Error, user not found!';
			return res.status(404).json(errors);
		} else {
			await User.findByIdAndDelete(deletedProfile.user);
			res.json({ deletedProfile, success: 'User deleted successfully!' });
		}
	} catch (err) {
		console.log(err);
		errors.profiles = 'Error deleting user!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
