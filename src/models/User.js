const { Schema, model } = require('mongoose');
const { genSalt, hash, compare } = require('bcrypt');
const { randomBytes, createHash } = require('crypto');

const userSchema = new Schema(
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
		phone: {
			type: String,
			required: [true, 'Mobile number is required'],
			trim: true,
			unique: true,
		},
		email: {
			type: String,
			required: [true, 'Email is required'],
			trim: true,
			unique: true,
		},
		password: {
			type: String,
			required: [true, 'Password is required'],
		},
		notify: {
			type: String,
			required: [true, 'Notification preference is required'],
			enum: ['sms', 'email'],
		},
		profilePic: {
			type: String,
			default:
				'http://localhost:3005/uploads/avatars/avatar_26.jpg',
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
				ref: 'User',
			},
		],
		passwordChangeAt: {
			type: Date,
		},
		passwordResetToken: {
			type: String,
		},
		passwordResetTokenExpires: {
			type: Date,
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

userSchema.virtual('myEvents', {
	ref: 'Event',
	localField: '_id',
	foreignField: 'createdBy',
});

userSchema.virtual('eventsAttending', {
	ref: 'Event',
	localField: '_id',
	foreignField: 'attendees._id',
	justOne: false,
	options: { match: { 'attendees._id': '$$localField' } },
});

userSchema.pre('save', function (next) {
	const user = this;
	if (!user.isModified('password')) {
		return next();
	}

	genSalt(10, (err, salt) => {
		if (err) {
			return next(err);
		}

		hash(user.password, salt, (err, _hash) => {
			if (err) {
				return next(err);
			}
			user.password = _hash;
			next();
		});
	});
});

userSchema.methods.comparePassword = function (candidatePassword) {
	const user = this;

	return new Promise((resolve, reject) => {
		compare(candidatePassword, user.password, (err, isMatch) => {
			if (err) {
				return reject(err);
			}

			if (!isMatch) {
				return reject(false);
			}

			resolve(true);
		});
	});
};

userSchema.methods.createPasswordResetToken = function () {
	const resetToken = randomBytes(32).toString('hex');
	this.passwordResetToken = createHash('sha256')
		.update(resetToken)
		.digest('hex');
	this.passwordResetTokenExpires = Date.now() + 30 * 60 * 1000;
	return resetToken;
};

model('User', userSchema);
