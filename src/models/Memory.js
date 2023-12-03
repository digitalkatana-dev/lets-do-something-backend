const { Schema, model } = require('mongoose');

const memorySchema = new Schema(
	{
		date: {
			type: String,
			required: true,
		},
		location: {
			type: String,
			required: true,
		},
		image: {
			type: String,
			required: true,
		},
		event: {
			type: Schema.Types.ObjectId,
			ref: 'Event',
			required: true,
		},
		uploadedBy: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
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

model('Memory', memorySchema);
