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
		notificationType: {
			type: String,
		},
		opened: {
			type: Boolean,
			default: false,
		},
		entityId: {
			type: Schema.Types.ObjectId,
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
	notificationType,
	entityId
) => {
	let data = {
		userTo: userTo,
		userFrom: userFrom,
		notificationType: notificationType,
		entityId: entityId,
	};

	await Notification.deleteOne(data).catch((err) => console.log(err));

	return Notification.create(data);
};

let Notification = model('Notification', notificationSchema);

module.exports = Notification;
