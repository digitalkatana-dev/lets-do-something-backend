const { Router } = require('express');
const { model } = require('mongoose');
const { config } = require('dotenv');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const sgMail = require('@sendgrid/mail');
const dayjs = require('dayjs');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const {
	isEmail,
	isPhone,
	validateEvent,
	validateRsvp,
} = require('../util/validators');
const requireAuth = require('../middleware/requireAuth');
const Event = model('Event');
const User = model('User');
const router = Router();
dayjs.extend(isSameOrAfter);
config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const twilioClient = require('twilio')(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN
);
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
	secure: true,
});

// Create
router.post('/events', requireAuth, async (req, res) => {
	const { _id } = req?.user;
	let eventData = {};

	const { valid, errors } = validateEvent(req?.body);

	if (!valid) return res.status(400).json(errors);

	try {
		const newEvent = new Event(req?.body);
		await newEvent?.save();

		req?.body?.invitedGuests?.forEach(async (item) => {
			if (item.notify === 'sms') {
				await twilioClient.messages.create({
					body: `You've been invited to ${req?.body?.type} on ${
						req?.body?.date
					} at ${dayjs(req?.body?.time).format('h:mm a')} by ${
						req?.user?.firstName
					}. Click here -> http://localhost:3000 to RSVP!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${item.phone}`,
				});
			} else if (item.notify === 'email') {
				const msg = {
					to: item.email,
					from: process.env.SG_BASE_EMAIL,
					subject: `You have been invited to ${req?.body?.type}!`,
					html: `<div>
						<h4>You've been invited to ${req?.body?.type} on ${req?.body?.date} at ${dayjs(
						req?.body?.time
					).format('h:mm a')} by ${req?.user?.firstName}.</h4>
						<h5>Click <a href="http://localhost:3000" style={{textDecoration: none}}>here</a> to RSVP!</h5>
					</div>`,
				};

				await sgMail.send(msg);
			}
		});

		res.json({
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
	let user;
	let events;
	let current;
	let memories;

	if (hasUser) user = await User.findById(hasUser);

	try {
		if (hasId) {
			events = await Event.findById(hasId);
			if (!events) {
				errors.message = 'Error, event not found!';
				return res.status(404).json(errors);
			}
		} else if (user) {
			events = await Event.find({
				$or: [
					{ isPublic: true },
					{
						'invitedGuests._id': user?.id,
					},
					{
						'invitedGuests.email': user?.email,
					},
					{
						'invitedGuests.phone': user.phone,
					},
				],
			}).sort('date');
		} else {
			events = await Event.find({}).sort('date');
		}

		if (Array.isArray(events)) {
			current =
				events.length > 0
					? events?.filter((item) =>
							dayjs(item.date).isSameOrAfter(new Date(), 'day')
					  )
					: null;
			memories =
				events.length > 0
					? events?.filter((item) => item.pics.length > 0)
					: null;
		}
		res.json({
			events,
			...(current && { current }),
			...(memories && { memories }),
		});
	} catch (err) {
		errors.message = 'Error getting events';
		return res.status(400).json(errors);
	}
});

// Update
router.put('/events/update', requireAuth, async (req, res) => {
	let errors = {};
	const eventId = req?.body?._id;

	const event = await Event.findById(eventId);

	if (!event) {
		errors.message = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	try {
		await Event.findByIdAndUpdate(
			eventId,
			{
				$set: req?.body,
			},
			{
				new: true,
				runValidators: true,
			}
		);

		res.json({
			success: { message: 'Event updated successfully!' },
		});
	} catch (err) {
		errors.message = 'Error updating event!';
		return res.status(400).json(errors);
	}
});

// Add/Remove Attendee
router.put('/events/attendee', requireAuth, async (req, res) => {
	const { valid, errors } = validateRsvp(req?.body);
	if (!valid) return res.status(400).json(errors);

	const { eventId } = req?.body;

	const event = await Event.findById(eventId);
	if (!event) {
		errors.message = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	const user = await User.findById(req?.user?._id);
	const attendees = event.attendees;
	const isAttending = attendees.includes(user?._id);
	const option = isAttending ? '$pull' : '$push';

	try {
		const attendee = {
			_id: user._id,
			name: user.firstName + ' ' + user.lastName,
			...(user.notify === 'sms' && { phone: user.phone }),
			...(user.notify === 'email' && { email: user.email }),
			headcount: req?.body?.headcount,
			notify: req?.user?.notify,
		};

		await Event.findByIdAndUpdate(
			eventId,
			{ [option]: { attendees: attendee } },
			{
				new: true,
				runValidators: true,
			}
		);

		if (option === '$push') {
			if (user.notify === 'sms') {
				await twilioClient.messages.create({
					body: `Your RSVP has been received!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${user.phone}`,
				});
			} else if (user.notify === 'email') {
				const msg = {
					to: user.email,
					from: process.env.SG_BASE_EMAIL,
					subject: 'RSVP Accepted!',
					text: "You have successfully RSVP'd for brunch",
					html: '<strong>See you there!</strong>',
				};

				await sgMail.send(msg);
			}
		} else if (option === '$pull') {
			if (user.notify === 'sms') {
				await twilioClient.messages.create({
					body: `Your RSVP has been canceled!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${user.phone}`,
				});
			} else if (user.notify === 'email') {
				const msg = {
					to: user.email,
					from: process.env.SG_BASE_EMAIL,
					subject: 'RSVP Canceled!',
					text: 'You have successfully canceled your RSVP for brunch',
					html: '<strong>Maybe next month!</strong>',
				};

				await sgMail.send(msg);
			}
		}

		res.json({
			success: { message: 'You are now attending this event!' },
		});
	} catch (err) {
		errors.message = 'Error adding attendee!';
		return res.status(400).json(errors);
	}
});

// Delete
router.delete('/events/:id', requireAuth, async (req, res) => {
	const errors = {};
	const { id } = req?.params;

	const deletedEvent = await Event.findByIdAndDelete(id);

	if (!deletedEvent) {
		errors.message = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	try {
		if (deletedEvent) {
			res.json({
				success: { message: 'Event deleted successfully!' },
			});
		}
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
				body: `You've been invited to ${type} on ${date} at ${dayjs(
					time
				).format('h:mm a')} by ${
					req?.user?.firstName
				}. Click here -> http://localhost:3000 to RSVP!`,
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
						<h5>Click <a href="http://localhost:3000" style={{textDecoration: none}}>here</a> to RSVP!</h5>
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

// Find And Invite
router.post('/events/find-and-invite', requireAuth, async (req, res) => {
	let errors = {};
	let user;
	let userData;

	const { guest, eventId, type, date, time } = req?.body;

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

		if (userData.notify === 'sms') {
			await twilioClient.messages.create({
				body: `You've been invited to ${type} on ${date} at ${dayjs(
					time
				).format('h:mm a')} by ${
					req?.user?.firstName
				}. Click here -> http://localhost:3000 to RSVP!`,
				from: process.env.TWILIO_NUMBER,
				to: `+1${userData.phone}`,
			});
		} else if (userData.notify === 'email') {
			const msg = {
				to: userData.email,
				from: process.env.SG_BASE_EMAIL,
				subject: `You have been invited to ${type}!`,
				html: `<div>
						<h4>You've been invited to ${type} on ${date} at ${dayjs(time).format(
					'h:mm a'
				)} by ${req?.user?.firstName}.</h4>
						<h5>Click <a href="http://localhost:3000" style={{textDecoration: none}}>here</a> to RSVP!</h5>
					</div>`,
			};

			await sgMail.send(msg);
		}

		const updatedEvent = await Event.findByIdAndUpdate(eventId, {
			$push: {
				invitedGuests: userData,
			},
		});

		res.json({
			updatedEvent,
			success: { message: 'Invite sent successfully' },
		});
	} catch (err) {
		errors.message = 'Error sending invite!';
		console.log('Invite Error:', err);
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
					body: 'You are only 1 week away from brunch!',
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

// Add Event Pic
const storage = multer.memoryStorage();
const filter = (req, file, cb) => {
	file.mimetype.startsWith('image')
		? cb(null, true)
		: cb({ message: 'Unsupported file format.' }, false);
};
const upload = multer({
	storage: storage,
	fileFilter: filter,
	limits: { fileSize: 6000000, fieldSize: 25 * 1024 * 1024 },
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
	'/events/photo-upload',
	requireAuth,
	upload.single('file'),
	async (req, res) => {
		let errors = {};

		const { b64str, date, location, eventId } = req?.body;

		try {
			const image = await cloudinaryUpload(b64str);
			const memory = {
				_id: `${Math.random().toString(16).substring(2, 8)}`,
				date,
				location,
				pic: image?.url,
				user: req?.user?.firstName + ' ' + req?.user?.lastName,
			};
			const updatedEvent = await Event.findByIdAndUpdate(
				eventId,
				{
					$push: {
						pics: memory,
					},
				},
				{
					new: true,
				}
			);

			const updatedAll = await Event.find({}).sort('date');
			const current =
				updatedAll.length > 0
					? updatedAll?.filter((item) =>
							dayjs(item.date).isSameOrAfter(new Date(), 'day')
					  )
					: null;
			const memories =
				updatedAll.length > 0
					? updatedAll?.filter((item) => item.pics.length > 0)
					: null;

			res.json({
				updatedEvent,
				updatedAll,
				current,
				memories,
				success: { message: 'Memory added successfully!' },
			});
		} catch (err) {
			errors.event = 'Error uploading memory!';
			console.log('Memory Error', err);
			return res.status(400).json(errors);
		}
	}
);

module.exports = router;
