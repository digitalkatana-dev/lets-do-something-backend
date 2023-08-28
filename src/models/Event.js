const { Schema, model } = require('mongoose');

const eventSchema = new Schema(
	{
		type: {
			type: String,
			required: true,
		},
		date: {
			type: String,
			required: true,
		},
		time: {
			type: String,
			required: true,
		},
		location: {
			type: String,
			required: true,
		},
		label: {
			type: String,
			required: true,
		},
		isPublic: {
			type: Boolean,
			default: false,
		},
		rsvpOpen: {
			type: Boolean,
		},
		invitedGuests: [
			{
				type: Object,
			},
		],
		attendees: [
			{
				type: Object,
			},
		],
		pics: [
			{
				type: Object,
			},
		],
		createdBy: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: [true, 'Author is required'],
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

model('Event', eventSchema);
