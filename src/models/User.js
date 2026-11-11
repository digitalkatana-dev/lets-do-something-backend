const { Schema, model } = require('mongoose');
const { genSalt, hash, compare } = require('bcrypt');
const { randomBytes, createHash } = require('crypto');

const userSchema = new Schema(
  {
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
  },
);

userSchema.virtual('profile', {
  ref: 'Profile',
  localField: '_id',
  foreignField: 'user',
  justOne: true,
});

userSchema.pre('save', async function () {
  const user = this;
  if (!user.isModified('password')) return;

  const salt = await genSalt(10);
  const _hash = await hash(user.password, salt);
  user.password = _hash;
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  const isMatch = await compare(candidatePassword, this.password);

  if (!isMatch) {
    throw new Error('Invalid password');
  }

  return true;
};

userSchema.methods.createPasswordResetToken = function () {
  const user = this;
  const resetToken = randomBytes(32).toString('hex');

  user.passwordResetToken = createHash('sha256')
    .update(resetToken)
    .digest('hex');

  user.passwordResetTokenExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

model('User', userSchema);
