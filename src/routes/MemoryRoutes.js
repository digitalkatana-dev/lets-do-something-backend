const { Router } = require('express');
const { model } = require('mongoose');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const requireAuth = require('../middleware/requireAuth');

const Memory = model('Memory');
const router = Router();

const storage = multer.diskStorage({
	destination: 'uploads/',
	filename: function (req, file, cb) {
		cb(null, file.originalname); // Use the original name as the filename
	},
});
const filter = (req, file, cb) => {
	file.mimetype.startsWith('image')
		? cb(null, true)
		: cb({ message: 'Unsupported file format.' }, false);
};
const upload = multer({
	storage: storage,
	fileFilter: filter,
	limits: { fileSize: 6000000000, fieldSize: 25 * 1024 * 1024 },
});

// Create
router.post(
	'/memories',
	requireAuth,
	upload.single('memory'),
	async (req, res) => {
		let errors = {};

		const filePath = `/uploads/images/${req?.file?.filename}.png`;
		const tempPath = req?.file?.path;
		const targetPath = path.join(__dirname, `../../${filePath}`);

		try {
			fs.rename(tempPath, targetPath, (error) => error && console.log(error));
			const memoryData = {
				date: req?.body?.date,
				location: req?.body?.location,
				image: `https://dosomething-backend.onrender.com${filePath}`,
				event: req?.body?.eventId,
				uploadedBy: req?.user?._id,
			};

			const newMemory = new Memory(memoryData);
			await newMemory?.save();

			res.status(201).json({
				newMemory,
				success: { message: 'Memory created successfully!' },
			});
		} catch (err) {
			console.log(err);
			errors.message = 'Error creating memory!';
			return res.status(400).json(errors);
		}
	}
);

// Read
router.get('/memories', async (req, res) => {
	let errors = {};
	const hasId = req?.query?.id;

	try {
		let memories;

		if (hasId) {
			memories = await Memory.findById(hasId)
				.populate('event')
				.populate('uploadedBy');

			if (!memories) {
				errors.message = 'Error, memory not found!';
				return res.status(404).json(errors);
			}
		} else {
			memories = await Memory.find({}).populate('event').populate('uploadedBy');
		}

		res.json(memories);
	} catch (err) {
		console.log(err);
		errors.message = 'Error getting memories!';
		return res.status(400).json(errors);
	}
});

// Update
router.put('/memories/:id', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const updated = await Memory.findByIdAndUpdate(
			id,
			{
				$set: req?.body,
			},
			{
				new: true,
			}
		);

		if (!updated) {
			errors.message = 'Error, memory not found!';
			return res.status(404).json(errors);
		}

		res.json({ message: 'Memory updated successfully!' });
	} catch (err) {
		console.log(err);
		errors.message = 'Error updating memory!';
		return res.status(400).json(errors);
	}
});

// Delete
router.delete('/memories/:id/delete', requireAuth, async (req, res) => {
	let errors = {};
	const { id } = req?.params;

	try {
		const deleted = await Memory.findByIdAndDelete(id);

		if (!deleted) {
			errors.message = 'Error, memory not found!';
			return res.status(404).json(errors);
		}

		res.json({
			deleted,
			success: { message: 'Memory forgotten successfully!' },
		});
	} catch (err) {
		console.log(err);
		errors.message = 'Error forgetting memory!';
		return res.status(400).json(errors);
	}
});

module.exports = router;
