const { Router } = require('express');
const { model } = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { authorize, protect } = require('../permissions');

const Memory = model('Memory');
const router = Router();

// Rules live in src/abac/policies.json
const canRead = authorize('read', 'memories', { anonymous: true });
const canCreate = protect('create', 'memories');
const canUpdate = protect('update', 'memories', { load: { model: Memory } });
const canDelete = protect('delete', 'memories', { load: { model: Memory } });

// Memories are public, so only expose safe fields of the documents they link to.
const publicEvent = { path: 'event', select: '-invitedGuests -attendees' };
const publicAuthor = {
  path: 'createdBy',
  select: 'firstName lastName profilePic',
};

const storage = multer.memoryStorage();
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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const cloudinaryUpload = async (fileToUpload) => {
  const options = {
    use_filename: true,
    unique_filename: true,
    overwrite: true,
    resource_type: 'auto',
  };

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(options, (error, result) => {
        if (!error && result && result.secure_url) {
          // console.log('Uploaded image URL:', result.secure_url);
          resolve(result.secure_url);
        } else {
          console.error('Error uploading image to Cloudinary:', error);
          reject(error);
        }
      })
      .end(fileToUpload.buffer);
  });
};

// Create
router.post(
  '/memories',
  canCreate,
  upload.single('memory'),
  async (req, res) => {
    let errors = {};

    try {
      const uploadedImage = await cloudinaryUpload(req?.file);

      const memoryData = {
        date: req?.body?.date,
        location: req?.body?.location,
        image: uploadedImage,
        event: req?.body?.eventId,
        createdBy: req?.profile?._id,
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
  },
);

// Read
router.get('/memories', canRead, async (req, res) => {
  let errors = {};
  const hasId = req?.query?.id;

  try {
    let memories;

    if (hasId) {
      memories = await Memory.findById(hasId)
        .populate(publicEvent)
        .populate(publicAuthor);

      if (!memories) {
        errors.message = 'Error, memory not found!';
        return res.status(404).json(errors);
      }
    } else {
      memories = await Memory.find({})
        .populate(publicEvent)
        .populate(publicAuthor);
    }

    res.json(memories);
  } catch (err) {
    console.log(err);
    errors.message = 'Error getting memories!';
    return res.status(400).json(errors);
  }
});

// Update
router.put('/memories/:id', canUpdate, async (req, res) => {
  let errors = {};
  const { id } = req?.params;
  // Who created a memory can't be changed
  const { createdBy, _id, ...changes } = req?.body ?? {};

  try {
    const updated = await Memory.findByIdAndUpdate(
      id,
      {
        $set: changes,
      },
      {
        new: true,
      },
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
router.delete('/memories/:id/delete', canDelete, async (req, res) => {
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
