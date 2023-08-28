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

// Add
router.post('/events', requireAuth, async (req, res) => {
	const { _id } = req?.user;
	let eventData = {};

	const { valid, errors } = validateEvent(req?.body);

	if (!valid) return res.status(400).json(errors);

	try {
		eventData = {
			...req?.body,
			createdBy: _id,
		};
		const newEvent = new Event(eventData);
		const event = await newEvent?.save();

		await User.findByIdAndUpdate(
			_id,
			{
				$push: {
					myEvents: {
						_id: event._id,
						type: event.type,
						date: event.date,
						time: event.time,
						isPublic: event.isPublic,
						...(event.rsvpOpen && { rsvpOpen: event.rsvpOpen }),
						location: event.location,
						label: event.label,
					},
				},
			},
			{
				new: true,
			}
		);

		req?.body?.invitedGuests?.forEach(async (item) => {
			if (item.notify === 'sms') {
				await twilioClient.messages.create({
					body: `You've been invited to ${req?.body?.type} on ${req?.body?.date} at ${req?.body?.time} by ${req?.user?.firstName}. Click here -> https://brunchfest.onrender.com to RSVP!`,
					from: process.env.TWILIO_NUMBER,
					to: `+1${item.phone}`,
				});
			} else if (item.notify === 'email') {
				const msg = {
					to: item.email,
					from: process.env.SG_BASE_EMAIL,
					subject: `You have been invited to ${req?.body?.type}!`,
					html: `<div>
						<h4>You've been invited to ${req?.body?.type} on ${req?.body?.date} at ${req?.body?.time} by ${req?.user?.firstName}.</h4>
						<h5>Click <a href="https://brunchfest.onrender.com" style={{textDecoration: none}}>here</a> to RSVP!</h5>
					</div>`,
				};

				await sgMail.send(msg);
			}
		});

		const allEvents = await Event.find({}).sort('date');
		const current =
			allEvents.length > 0
				? allEvents?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;

		res.json({
			event,
			allEvents,
			current,
			success: { message: 'Event created successfully!' },
		});
	} catch (err) {
		errors.event = 'Error creating event!';
		console.log(err);
		return res.status(400).json(errors);
	}
});

// Update
router.put('/events/update', requireAuth, async (req, res) => {
	let errors = {};
	const eventId = req?.body?._id;
	const userId = req?.user?._id;

	const event = await Event.findById(eventId);

	if (!event) {
		errors.event = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	try {
		const updatedEvent = await Event.findByIdAndUpdate(
			eventId,
			{
				$set: req?.body,
			},
			{
				new: true,
				runValidators: true,
			}
		);

		const updatedUserEvents = await Event.find({
			createdBy: userId,
		}).sort('date');

		await User.findByIdAndUpdate(
			userId,
			{
				$set: {
					myEvents: updatedUserEvents,
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

		res.json({
			updatedEvent,
			updatedAll,
			current,
			success: { message: 'Event updated successfully!' },
		});
	} catch (err) {
		errors.event = 'Error updating event!';
		return res.status(400).json(errors);
	}
});

// Send Invite
router.post('/events/invite', requireAuth, async (req, res) => {
	let errors = {};
	const { guest, type, date, time } = req?.body;

	try {
		if (isPhone(guest)) {
			await twilioClient.messages.create({
				body: `You've been invited to ${type} on ${date} at ${time} by ${req?.user?.firstName}. Click here -> https://brunchfest.onrender.com to RSVP!`,
				from: process.env.TWILIO_NUMBER,
				to: `+1${guest}`,
			});
		} else if (isEmail(guest)) {
			const msg = {
				to: guest,
				from: process.env.SG_BASE_EMAIL,
				subject: `You have been invited to ${type}!`,
				html: `<div>
						<h4>You've been invited to ${type} on ${date} at ${time} by ${req?.user?.firstName}.</h4>
						<h5>Click <a href="https://brunchfest.onrender.com" style={{textDecoration: none}}>here</a> to RSVP!</h5>
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

// Get All
router.get('/events', async (req, res) => {
	let errors = {};

	try {
		const events = await Event.find({}).sort('date');
		const current =
			events.length > 0
				? events?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;
		const memories =
			events.length > 0 ? events?.filter((item) => item.pics.length > 0) : null;
		res.json({ all: events, current, memories });
	} catch (err) {
		errors.event = 'Error getting events';
		return res.status(400).json(errors);
	}
});

// Get Invited
router.get('/events/invited', requireAuth, async (req, res) => {
	let errors = {};

	try {
		const events = await Event.find({}).sort('date');
		const invited = events?.filter(
			(event) =>
				event?.isPublic === true ||
				event?.invitedGuests?.find(
					(item) =>
						item?.phone === req?.user?.phone ||
						item?.email === req?.user?.email ||
						item?._id == req?.user?._id
				)
		);
		const current =
			invited.length > 0
				? invited?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;

		const memories =
			events.length > 0 ? events.filter((item) => item.pics.length > 0) : null;

		res.json({ invited, current, memories });
	} catch (err) {
		errors.event = 'Error getting events';
		console.log(err);
		return res.status(400).json(errors);
	}
});

// Get 1
router.get('/events/:id', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const event = await Event.findById(id);

		if (!event) {
			errors.event = 'Error, event not found!';
			return res.status(404).json(errors);
		}

		res.json(event);
	} catch (err) {
		errors.event = 'Error getting event';
		return res.status(400).json(errors);
	}
});

// Add Attendee
router.put('/events/add-attendee', requireAuth, async (req, res) => {
	const targetEvent = await Event.findById(req?.body?.eventId);
	const alreadyAttending = targetEvent?.attendees?.find(
		(user) => user?._id.toString() === req?.user?._id.toString()
	);

	const { valid, errors } = validateRsvp(req?.body);

	if (!valid) return res.status(400).json(errors);

	if (alreadyAttending) {
		errors.event = 'You are already attending this event!';
		return res.status(400).json(errors);
	}

	const user = await User.findById(req?.user?._id);

	const attendee = {
		_id: user._id,
		name: user.firstName + ' ' + user.lastName,
		...(user.notify === 'sms' && { phone: user.phone }),
		...(user.notify === 'email' && { email: user.email }),
		headcount: req?.body?.headcount,
		notify: req?.user?.notify,
	};

	try {
		const event = await Event.findByIdAndUpdate(
			req?.body?.eventId,
			{
				$push: {
					attendees: attendee,
				},
			},
			{
				new: true,
				runValidators: true,
			}
		);

		const ownerId = event?.createdBy;

		const owner = await User.findById(ownerId);

		await User.findByIdAndUpdate(
			req?.user?._id,
			{
				$push: {
					eventsAttending: {
						_id: event._id,
						type: event.type,
						date: event.date,
						time: event.time,
						location: event.location,
						label: event.label,
						createdBy: owner.firstName + ' ' + owner.lastName,
					},
				},
			},
			{
				new: true,
			}
		);

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

		const updatedEvent = await Event.findById(req?.body?.eventId);
		const updatedAll = await Event.find({}).sort('date');
		const current =
			updatedAll.length > 0
				? updatedAll?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;
		const updatedUser = await User.findById(req?.user?._id);
		const updatedEventsAttending = updatedUser?.eventsAttending;

		res.json({
			updatedAll,
			current,
			updatedEvent,
			updatedEventsAttending,
			success: { message: 'You are now attending this event!' },
		});
	} catch (err) {
		errors.event = 'Error adding attendee!';
		return res.status(400).json(errors);
	}
});

// Remove Attendee
router.put('/events/remove-attendee', requireAuth, async (req, res) => {
	let errors = {};
	const targetEvent = await Event.findById(req?.body?.eventId);
	const alreadyAttending = targetEvent?.attendees?.find(
		(user) => user?._id.toString() === req?.user?._id.toString()
	);

	if (!alreadyAttending) {
		errors.event = 'You are not currently attending this event!';
		return res.status(400).json(errors);
	}

	const user = await User.findById(req?.user?._id);

	const attendee = {
		_id: user._id,
		name: user.firstName + ' ' + user.lastName,
		headcount: req?.body?.headcount,
	};

	try {
		await Event.findByIdAndUpdate(
			req?.body?.eventId,
			{
				$pull: {
					attendees: attendee,
				},
			},
			{
				new: true,
				runValidators: true,
			}
		);

		const userEvents = user?.eventsAttending;
		const updatedEvents = userEvents.filter(
			(item) => item.id != req?.body?.eventId
		);

		await User.findByIdAndUpdate(
			req?.user?._id,
			{
				$set: {
					eventsAttending: updatedEvents,
				},
			},
			{
				new: true,
				runValidators: true,
			}
		);

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

		const updatedEvent = await Event.findById(req?.body?.eventId);
		const updatedAll = await Event.find({}).sort('date');
		const current =
			updatedAll.length > 0
				? updatedAll?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;
		const updatedUser = await User.findById(req?.user?._id);
		const updatedEventsAttending = updatedUser?.eventsAttending;

		res.json({
			updatedAll,
			current,
			updatedEvent,
			updatedEventsAttending,
			success: { message: 'You are no longer attending this event!' },
		});
	} catch (err) {
		errors.event = 'Error removing attendee!';
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

// Delete
router.delete('/events/:id', requireAuth, async (req, res) => {
	const errors = {};
	const { id } = req?.params;

	const event = await Event.findById(id);

	if (!event) {
		errors.event = 'Error, event not found!';
		return res.status(404).json(errors);
	}

	const user = await User.findById(req?.user?._id);

	try {
		await Event.findByIdAndDelete(id);
		const updatedAll = await Event.find({}).sort('date');
		const current =
			updatedAll.length > 0
				? updatedAll?.filter((item) =>
						dayjs(item.date).isSameOrAfter(new Date(), 'day')
				  )
				: null;

		const userEvents = user?.myEvents;
		const updatedEvents =
			userEvents.length > 0
				? userEvents.filter((item) => item._id != id)
				: null;

		await User.findByIdAndUpdate(
			req?.user?._id,
			{
				$set: { myEvents: updatedEvents },
			},
			{
				new: true,
				runValidators: true,
			}
		);

		const memories =
			updatedAll?.length > 0
				? updatedAll.filter((item) => item.pics.length > 0)
				: null;

		res.json({
			updatedAll,
			current,
			memories,
			success: { message: 'Event deleted successfully!' },
		});
	} catch (err) {
		errors.event = 'Error deleting event!';
		return res.status(400).json(err);
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
