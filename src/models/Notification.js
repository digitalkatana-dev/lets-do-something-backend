const { Schema, model } = require('mongoose');

const notificationSchema = new Schema(
	{
		userTo: {
			type: Schema.Types.ObjectId,
			ref: 'User',
		},
		userFrom: {
			type: Schema.Types.ObjectId,
			ref: 'User',
		},
		event: {
			type: String,
		},
		label: {
			type: String,
		},
		notificationType: {
			type: String,
		},
		opened: {
			type: Boolean,
			default: false,
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

notificationSchema.statics.insertNotification = async (
	userTo,
	userFrom,
	event,
	label,
	notificationType
) => {
	let data = {
		userTo: userTo,
		userFrom: userFrom,
		event: event,
		label: label,
		notificationType: notificationType,
	};

	await Notification.deleteOne(data).catch((err) => console.log(err));

	return Notification.create(data);
};

let Notification = model('Notification', notificationSchema);

module.exports = Notification;
