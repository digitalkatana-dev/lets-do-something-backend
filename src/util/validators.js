const isEmail = (data) => {
	const regEx =
		/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
	if (data?.match(regEx)) return true;
	else return false;
};

const isPhone = (data) => {
	const regEx = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
	if (data?.match(regEx)) return true;
	else return false;
};

const isNumber = (data) => {
	const regex = /^\d+$/;
	if (data?.match(regex)) return true;
	else return false;
};

const isEmpty = (data) => {
	if (data?.trim() === '') return true;
	else return false;
};

exports.isEmail = (data) => {
	const regEx =
		/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
	if (data?.match(regEx)) return true;
	else return false;
};

exports.isPhone = (data) => {
	const regEx = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
	if (data?.match(regEx)) return true;
	else return false;
};

exports.validateRegistration = (data) => {
	let errors = {};

	if (isEmpty(data?.firstName)) errors.firstName = 'Must not be empty!';
	if (isEmpty(data?.lastName)) errors.lastName = 'Must not be empty!';
	if (isEmpty(data?.phone)) {
		errors.phone = 'Must not be empty!';
	} else if (!isPhone(data?.phone)) {
		errors.phone = 'Must be a valid phone number!';
	}
	if (isEmpty(data?.email)) {
		errors.email = 'Must not be empty!';
	} else if (!isEmail(data?.email)) {
		errors.email = 'Must be a valid email address!';
	}
	if (isEmpty(data?.password)) errors.password = 'Must not be empty!';
	if (isEmpty(data?.notify)) errors.notify = 'Must not be empty!';

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};

exports.validateLogin = (data) => {
	let errors = {};

	if (isEmpty(data?.email)) {
		errors.email = 'Must not be empty!';
	} else if (!isEmail(data?.email)) {
		errors.email = 'Must be a valid email address!';
	}
	if (isEmpty(data?.password)) errors.password = 'Must not be empty!';

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};

exports.validateForgot = (data) => {
	let errors = {};

	if (isEmpty(data?.email)) {
		errors.email = 'Must not be empty!';
	} else if (!isEmail(data?.email)) {
		errors.email = 'Must be a valid email address!';
	}

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};

exports.validateReset = (data) => {
	let errors = {};

	if (isEmpty(data?.password)) errors.password = 'Must not be empty!';

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};

exports.validateEvent = (data) => {
	let errors = {};

	if (isEmpty(data?.type)) errors.type = 'Must not be empty!';
	if (isEmpty(data?.date)) errors.date = 'Must not be empty!';
	if (isEmpty(data?.time)) errors.time = 'Must not be empty!';
	if (isEmpty(data?.location)) errors.location = 'Must not be empty!';

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};

exports.validateRsvp = (data) => {
	let errors = {};

	if (isEmpty(data?.headcount)) {
		errors.headcount = 'Must not be empty!';
	} else if (!isNumber(data?.headcount)) {
		errors.headcount = 'Numbers only!';
	}

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false,
	};
};
