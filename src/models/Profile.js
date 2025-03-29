const { Schema, model } = require('mongoose');

const profileSchema = new Schema(
	{
		firstName: {
			type: String,
			required: [true, 'First name is required'],
			trim: true,
		},
		lastName: {
			type: String,
			required: [true, 'Last name is required'],
			trim: true,
		},
		email: {
			type: String,
			required: [true, 'Email is required'],
			trim: true,
			unique: true,
		},
		phone: {
			type: String,
			trim: true,
		},
		notify: {
			type: String,
			required: [true, 'Notification preference is required'],
			enum: ['sms', 'email'],
		},
		profilePic: {
			type: String,
			default:
				'https://dosomething-backend.onrender.com/uploads/avatars/avatar_26.jpg',
		},
		coverPhoto: {
			type: String,
		},
		isAdmin: {
			type: Boolean,
			required: true,
			default: false,
		},
		friends: [
			{
				type: Schema.Types.ObjectId,
				ref: 'Profile',
			},
		],
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: [true, 'User is required.'],
		},
	},
	{
		toJSON: {
			virtuals: true,
		},
		toObject: {
			virtuals: true,
		},
		timestamps: true,
	}
);

profileSchema.virtual('myEvents', {
	ref: 'Event',
	localField: '_id',
	foreignField: 'createdBy',
});

profileSchema.virtual('eventsAttending', {
	ref: 'Event',
	localField: '_id',
	foreignField: 'attendees._id',
	justOne: false,
	options: { match: { 'attendees._id': '$$localField' } },
});

model('Profile', profileSchema);
