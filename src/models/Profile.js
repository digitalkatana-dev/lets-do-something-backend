const { Schema, model } = require('mongoose');

const profileSchema = new Schema(
	{
		firstName: {
			type: String,
			trim: true,
		},
		lastName: {
			type: String,
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
			enum: ['sms', 'email'],
			default: 'email',
		},
		profilePic: {
			type: String,
			default: 'http://localhost:3005/uploads/avatars/avatar_26.jpg',
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
		firstLogin: {
			type: Boolean,
			default: true,
		},
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
