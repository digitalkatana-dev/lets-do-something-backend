const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const router = Router();

// Get uploads - images
router.get('/uploads/images/:path', async (req, res) => {
	try {
		res.sendFile(path.join(__dirname, `uploads/images/${req?.params?.path}`));
	} catch (err) {
		console.log(err);
	}
});

// Delete File
router.delete('/uploads/delete/:filename', async (req, res) => {
	const { filename } = req?.params;
	const filePath = path.join(__dirname, '../../uploads/images', filename);
	console.log(filePath);

	// Check if the file exists
	if (fs.existsSync(filePath)) {
		// Delete the file
		fs.unlink(filePath, (err) => {
			if (err) {
				console.error('Error deleting file:', err);
				res.status(500).send('Error deleting file');
			} else {
				console.log('File deleted successfully');
				res.send('File deleted');
			}
		});
	} else {
		console.log('File not found');
		res.status(404).send('File not found');
	}
});

// Show Contents uploads
router.get('/uploads/contents', async (req, res) => {
	const directoryPath = path.join(__dirname, '../../uploads');
	fs.readdir(directoryPath, (err, files) => {
		if (err) {
			console.error('Error reading directory:', err);
			res.status(500).send('Error reading directory');
		} else {
			res.json({ files });
		}
	});
});

// Show Contents images
router.get('/uploads/contents/images', async (req, res) => {
	const directoryPath = path.join(__dirname, '../../uploads/images');
	fs.readdir(directoryPath, (err, files) => {
		if (err) {
			console.error('Error reading directory:', err);
			res.status(500).send('Error reading directory');
		} else {
			res.json({ files });
		}
	});
});

// Get uploads - avatars
router.get('/uploads/avatars/:path', async (req, res) => {
	try {
		res.sendFile(path.join(__dirname, `uploads/avatars/${req?.params?.path}`));
	} catch (err) {
		console.log(err);
	}
});

// Get uploads - covers
router.get('/uploads/covers/:path', async (req, res) => {
	try {
		res.sendFile(path.join(__dirname, `uploads/covers/${req?.params?.path}`));
	} catch (err) {
		console.log(err);
	}
});

module.exports = router;
