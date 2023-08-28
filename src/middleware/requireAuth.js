const { verify } = require('jsonwebtoken');
const { model } = require('mongoose');
const User = model('User');

module.exports = (req, res, next) => {
	const { authorization } = req?.headers;

	if (!authorization) return res.status(401).json('You must be logged in.');

	try {
		const token = authorization.replace('Bearer ', '');
		if (token) {
			verify(token, process.env.DB_SECRET_KEY, async (err, payload) => {
				const { userId } = payload;
				const user = await User.findById(userId).select('-password');
				req.user = user;
				next();
			});
		} else {
			return res.status(401).json('You must be logged in.');
		}
	} catch (err) {
		console.log('Auth Error', err);
		return res.status(401).json('You must be logged in.');
	}
};
