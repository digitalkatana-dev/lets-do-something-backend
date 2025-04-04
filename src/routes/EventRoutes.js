const { Router } = require('express');
const { model, isValidObjectId } = require('mongoose');
const { config } = require('dotenv');
const sgMail = require('@sendgrid/mail');
const dayjs = require('dayjs');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const {
	isEmail,
	isPhone,
	validateEvent,
	validateRsvp,
} = require('../util/validators');
const requireAuth = require('../middleware/requireAuth');
const Event = model('Event');
const Profile = model('Profile');
const Notification = model('Notification');
const router = Router();
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const twilioClient = require('twilio')(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN
);

// Create
router.post('/events', requireAuth, async (req, res) => {
	const { _id, firstName, lastName } = req?.user;

	const { valid, errors } = validateEvent(req?.body);

	if (!valid) return res.status(400).json(errors);

	const { type, date, time, label, notes } = req?.body;
	const host = req?.user?.firstName + ' ' + req?.user?.lastName;
	let subject;
	let smsMessage;
	let emailOpener;

	if (type === 'Party') {
		subject = `You've been invited to a ${type}!`;
		smsMessage = `Let's Do Something: Great news! You've been invited to a ${type} on ${date} at ${dayjs(
			time
		).format(
			'h:mm a'
		)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
		emailOpener = `You've been invited to a ${type} on ${date} at ${dayjs(
			time
		).format('h:mm a')} by ${host}.`;
	} else if (type === 'Movies') {
		subject = `You've been invited to the ${type}!`;
		smsMessage = `Let's Do Something: Great news! You've been invited to the ${type} on ${date} at ${dayjs(
			time
		).format(
			'h:mm a'
		)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
		emailOpener = `You've been invited to the ${type} on ${date} at ${dayjs(
			time
		).format('h:mm a')} by ${host}.`;
	} else {
		subject = `You've been invited to ${type}!`;
		smsMessage = `Let's Do Something: Great news! You've been invited to ${type} on ${date} at ${dayjs(
			time
		).format(
			'h:mm a'
		)} by ${host}. Click here -> https://letsdosomething.net to RSVP!`;
		emailOpener = `You've been invited to ${type} on ${date} at ${dayjs(
			time
		).format('h:mm a')} by ${host}.`;
	}

	try {
		let invitedGuests = req?.body?.invitedGuests;
		invitedGuests = invitedGuests.push({
			_id,
			firstName,
			lastName,
		});

		const newEvent = new Event(req?.body);
		await newEvent?.save();

		req?.body?.invitedGuests?.forEach(async (item) => {
			const isUser = isValidObjectId(item._id);

			if (item.notify === 'sms') {
				await twilioClient.messages.create({
					body: smsMessage,
					from: process.env.TWILIO_NUMBER,
					to: `+1${item.phone}`,
				});
			} else if (item.notify === 'email') {
				const msg = {
					to: item.email,
					from: process.env.SG_BASE_EMAIL,
					subject: subject,
					html: `<div style="max-width: 800px; display: flex; flex-direction: column; text-align: center; border: 5px solid ${label};">
						<h3>${emailOpener}</h3> \n
						<h4>Notes from host: ${notes}</h4> \n
						<h3>Click <a href="https://letsdosomething.net" style="text-decoration: none; color: ${label}">here</a> to RSVP!</h3>
					</div>`,
				};

				await sgMail.send(msg);
			}

			if (isUser) {
				await Notification.insertNotification(
					item._id,
					_id,
					newEvent?.type,
					newEvent?.label,
					'invite'
				);
			}
		});

		res.json({
			newEvent,
			success: { message: 'Event created successfully!' },
		});
	} catch (err) {
		console.log(err);
		errors.message = 'Error creating event!';
		return res.status(400).json(errors);
	}
});

// Read
router.get('/events', async (req, res) => {
	let errors = {};
	const hasUser = req?.query?.user;
	const hasId = req?.query?.id;

	try {
		const users = await Profile.find({});
		let events;
		let current;
		let invited;

		if (hasId) {
			events = await Event.findById(hasId).populate('createdBy');
			if (!events) {
				errors.events = 'Error, event not found!';
				return res.status(404).json(errors);
			}

			invited = events.invitedGuests;
			// Replace invited guests' data if match found in userData
			invited.forEach((invitedGuest) => {
				const matchingUser = users.find(
					(user) =>
						user.email === invitedGuest._id || user.phone === invitedGuest._id
				);

				if (matchingUser) {
					invitedGuest._id = matchingUser._id;
					invitedGuest.firstName = matchingUser.firstName;
					invitedGuest.lastName = matchingUser.lastName;
					invitedGuest.phone = matchingUser.phone;
					invitedGuest.email = matchingUser.email;
					invitedGuest.notify = matchingUser.notify;
					invitedGuest.profilePic = matchingUser.profilePic;
					// Update other properties accordingly
				}
			});

			events = await Event.findByIdAndUpdate(
				events._id,
				{
					$set: {
						invitedGuests: invited,
					},
				},
				{
					new: true,
				}
			).populate('createdBy');

			res.json(events);
		} else if (hasUser) {
			const user = await Profile.findById(hasUser);

			if (!user) {
				errors.events = 'Error, user not found!';
				return res.status(404).json(errors);
			}

			events = await Event.find({
				$or: [
					{
						isPublic: true,
					},
					{
						createdBy: user?._id,
					},
					{
						'invitedGuests._id': user?.id,
					},
					{
						'invitedGuests.email': user?.email,
					},
					{
						'invitedGuests.phone': user?.phone,
					},
				],
			})
				.populate('createdBy')
				.sort('date');

			for (const event of events) {
				invited = event.invitedGuests;

				for (const guest of invited) {
					const matchingUser = users.find(
						(user) => user.email === guest._id || user.phone === guest._id
					);

					if (matchingUser) {
						guest._id = matchingUser._id;
						// Update other properties accordingly
					}
				}

				await Event.findByIdAndUpdate(event._id, {
					$set: {
						invitedGuests: invited,
					},
				});
			}
			current =
				events.filter((item) =>
					dayjs(item.date).isSameOrAfter(new Date(), 'day')
				) == []
					? null
					: events.filter(
							(item) =>
								dayjs(item.date).isSameOrAfter(new Date(), 'day') &&
								dayjs(item.date).year() === dayjs().year()
					  );

			res.json({ events, current });
		} else {
			events = await Event.find({}).populate('createdBy').sort('date');

			for (const event of events) {
				let invited = event.invitedGuests;

				for (const guest of invited) {
					const matchingUser = users.find(
						(user) => user.email === guest._id || user.phone === guest._id
					);

					if (matchingUser) {
						guest._id = matchingUser._id;
						// Update other properties accordingly
					}
				}

				await Event.findByIdAndUpdate(event._id, {
					$set: {
						invitedGuests: invited,
					},
				});
			}

			current =
				events?.filter((item) =>
					dayjs(item.date).isSameOrAfter(new Date(), 'day')
				) == []
					? null
					: events?.filter(
							(item) =>
								dayjs(item.date).isSameOrAfter(new Date(), 'day') &&
								dayjs(item.date).year() === dayjs().year()
					  );

			res.json({ events, current });
		}
	} catch (err) {
		console.log(err);
		errors.events = 'Error getting events!';
		return res.status(400).json(errors);
	}
});

// Update
router.put('/events/update', requireAuth, async (req, res) => {
	let errors = {};
	const eventId = req?.body?._id;

	try {
		const updated = await Event.findByIdAndUpdate(
			eventId,
			{
				$set: req?.body,
			},
			{
				new: true,
				runValidators: true,
			}
		).populate('createdBy');

		if (!updated) {
			errors.message = 'Error, event not found!';
			return res.status(404).json(errors);
		}

		res.json({
			updated,
			success: { message: 'Event updated successfully!' },
		});
	} catch (err) {
		errors.message = 'Error updating event!';
		return res.status(400).json(errors);
	}
});

// Add/Remove Guest
router.put('/events/guests', requireAuth, async (req, res) => {
	let errors = {};
	try {
		const { eventId, guest } = req?.body;
		const event = await Event.findById(eventId);
		const invited = event.invitedGuests;
		const updatedGuests = invited.filter((item) => item._id != guest);

		const updated = await Event.findByIdAndUpdate(
			eventId,
			{
				$set: { invitedGuests: updatedGuests },
			},
			{
				new: true,
			}
		).populate('createdBy');

		if (!updated) {
			errors.message = 'Error, event not found!';
			return res.status(404).json(errors);
		}

		res.json({ updated, success: { message: 'Guest removed successfully!' } });
	} catch (err) {
		console.log(err);
		errors.message = 'Error removing guest!';
		return res.status(400).json(errors);
	}
});

// Add/Remove Attendee
router.put('/events/rsvp', requireAuth, async (req, res) => {
	const { valid, errors } = validateRsvp(req?.body);
	if (!valid) return res.status(400).json(errors);

	const user = req?.user;
	const { eventId } = req?.body;

	const event = await Event.findById(eventId).populate('createdBy');
	if (!event) {
		errors.message = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	const attendees = event.attendees;
	const isAttending = attendees.some((item) => item._id == user?.id);
	const option = isAttending ? '$pull' : '$push';
	const successMessage =
		option === '$pull'
			? 'You are no longer attending this event!'
			: 'You are now attending this event!';

	try {
		const attendee = {
			_id: user?._id,
			name: user.firstName + ' ' + user.lastName,
			...(user.notify === 'sms' && { phone: user.phone }),
			...(user.notify === 'email' && { email: user.email }),
			headcount: req?.body?.headcount,
			notify: user.notify,
		};

		const updated = await Event.findByIdAndUpdate(
			eventId,
			{ [option]: { attendees: attendee } },
			{
				new: true,
				runValidators: true,
			}
		).populate('createdBy');

		if (option === '$push') {
			const headcountMessage =
				req?.body?.headcount - 1 > 0
					? ` and your ${req?.body?.headcount - 1} guest(s)`
					: '';
			if (user.notify === 'sms') {
				await twilioClient.messages.create({
					body: `Let's Do Something: Hello, ${
						user.firstName
					}! Your RSVP has been received! We can't wait to see you${headcountMessage}! If you have any questions, please contact the host at ${
						event.createdBy.notify === 'sms'
							? event.createdBy.phone
							: event.createdBy.notify === 'email' && event.createdBy.email
					}. See you there! `,
					from: process.env.TWILIO_NUMBER,
					to: `+1${user.phone}`,
				});
			} else if (user.notify === 'email') {
				const msg = {
					to: user.email,
					from: process.env.SG_BASE_EMAIL,
					subject: 'RSVP Accepted!',
					html: `<div style="max-width: 800px; text-align: center; border: 5px solid ${
						event.label
					};">
						<h3>Hello, ${user?.firstName}!</h3>
						<h4>Your RSVP has been received! We can't wait to see you${headcountMessage}!</h4>
						<h4>If you have any questions, please contact the host at ${
							event.createdBy.notify === 'sms'
								? event.createdBy.phone
								: event.createdBy.notify === 'email' && event.createdBy.email
						}. See you there!</h4>
					</div>`,
				};

				await sgMail.send(msg);
			}

			await Notification.insertNotification(
				event?.createdBy,
				attendee?._id,
				updated?.type,
				updated?.label,
				'rsvp'
			);
		} else if (option === '$pull') {
			if (user.notify === 'sms') {
				await twilioClient.messages.create({
					body: `Let's Do Something: Hello, ${user.firstName}! We get it, sometimes things come up. With that in mind, your RSVP for ${event.type} has been canceled. We hope all is well, and that you can make it to the next event!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${user.phone}`,
				});
			} else if (user.notify === 'email') {
				const msg = {
					to: user.email,
					from: process.env.SG_BASE_EMAIL,
					subject: "Sorry you can't make it...",
					html: `<div style="max-width: 800px; text-align: center; border: 5px solid ${event.label}">
						<h3>Hello, ${user?.firstName}!</h3>
						<h4>We get it, sometimes things come up. With that in mind, your RSVP for ${event.type} has been canceled.</h4>
						<h3>We hope all is well, and that you can make it to the next event!</h3>
					</div>`,
				};
				await sgMail.send(msg);
			}
		}

		res.json({
			updated,
			success: { message: successMessage },
		});
	} catch (err) {
		console.log(err);
		errors.message = 'Error adding attendee!';
		return res.status(400).json(errors);
	}
});

// Delete
router.delete('/events/:id', requireAuth, async (req, res) => {
	const errors = {};

	try {
		const { id } = req?.params;
		const deletedEvent = await Event.findByIdAndDelete(id).populate(
			'createdBy'
		);

		if (!deletedEvent) {
			errors.message = 'Error, event not found!';
			return res.status(404).json(errors);
		}

		if (dayjs(new Date()).isBefore(dayjs(new Date(deletedEvent.date)))) {
			const { type, date, time, label, createdBy, invitedGuests } =
				deletedEvent;
			const host = createdBy.firstName + ' ' + createdBy.lastName;
			let subject = `${type} has been cancelled`;
			let smsMessage;
			let emailMessage;

			if (type === 'Party' || type === 'Movies') {
				smsMessage = `Let's Do Something: Unfortunately, the ${type} on ${date} at ${dayjs(
					time
				).format(
					'h:mm a'
				)} hosted by ${host}, has been cancelled. If you have already RSVP'd, please remember to remove it from your calendar.`;
				emailMessage = `Unfortunately, the ${type} on ${date} at ${dayjs(
					time
				).format(
					'h:mm a'
				)} hosted by ${host}, has been cancelled. If you have already RSVP'd, please remember to remove it from your calendar.`;
			} else {
				smsMessage = `Let's Do Something: Unfortunately, ${type} on ${date} at ${dayjs(
					time
				).format(
					'h:mm a'
				)} hosted by ${host}, has been cancelled. If you have already RSVP'd, please remember to remove it from your calendar.`;
				emailMessage = `Unfortunately, ${type} on ${date} at ${dayjs(
					time
				).format(
					'h:mm a'
				)} hosted by ${host}, has been cancelled. If you have already RSVP'd, please remember to remove it from your calendar.`;
			}

			invitedGuests?.forEach(async (item) => {
				if (item.notify === 'sms') {
					await twilioClient.messages.create({
						body: smsMessage,
						from: process.env.TWILIO_NUMBER,
						to: `+1${item.phone}`,
					});
				} else if (item.notify === 'email') {
					const msg = {
						to: item.email,
						from: process.env.SG_BASE_EMAIL,
						subject: subject,
						html: `<div style="max-width: 800px; display: flex; flex-direction: column; text-align: center; border: 5px solid ${label}; padding: 20px;">
							<h3>${emailMessage}</h3>
						</div>`,
					};

					await sgMail.send(msg);
				}
			});
		}

		res.json({
			success: { message: 'Event deleted successfully!' },
		});
	} catch (err) {
		errors.message = 'Error deleting event!';
		return res.status(400).json(errors);
	}
});

// Send Invite
router.post('/events/invite', requireAuth, async (req, res) => {
	let errors = {};
	const { guest, type, date, time } = req?.body;

	try {
		if (guest.notify === 'sms' && isPhone(guest.phone)) {
			await twilioClient.messages.create({
				body: `Let's Do Something: Great news! You've been invited to ${type} on ${date} at ${dayjs(
					time
				).format('h:mm a')} by ${
					req?.user?.firstName
				}. Click here -> https://letsdosomething.net to RSVP!`,
				from: process.env.TWILIO_NUMBER,
				to: `+1${guest.phone}`,
			});
		} else if (guest.notify === 'email' && isEmail(guest.email)) {
			const msg = {
				to: guest.email,
				from: process.env.SG_BASE_EMAIL,
				subject: `You have been invited to ${type}!`,
				html: `<div>
						<h4>You've been invited to ${type} on ${date} at ${dayjs(time).format(
					'h:mm a'
				)} by ${req?.user?.firstName}.</h4>
						<h5>Click <a href="https://letsdosomething.net" style={{textDecoration: none}}>here</a> to RSVP!</h5>
					</div>`,
			};

			await sgMail.send(msg);
		}

		res.json({ message: 'Invite sent successfully!' });
	} catch (err) {
		errors.event = 'Error sending invite!';
		console.log('Invite Error', err);
		return res.status(400).json(errors);
	}
});

// Send Reminders
router.post('/events/reminders', requireAuth, async (req, res) => {
	let errors = {};
	const targetEvent = await Event.findById(req?.body?.eventId);

	try {
		targetEvent.attendees.forEach(async (guest) => {
			if (guest.notify === 'sms') {
				await twilioClient.messages.create({
					body: `Let's Do Something: Update! You are only 1 week away from brunch!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${guest.phone}`,
				});
			} else if (guest.notify === 'email') {
				const msg = {
					to: guest.email,
					from: process.env.SG_BASE_EMAIL,
					subject: 'Almost There...',
					text: 'You are only 1 week away from brunch!',
					html: '<strong>So close!</strong>',
				};

				await sgMail.send(msg);
			}
		});

		res.json({ message: 'Reminders sent successfully!' });
	} catch (err) {
		errors.event = 'Error sending reminders!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
