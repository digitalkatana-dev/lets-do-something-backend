const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { protect } = require('../permissions');
const router = Router();

// Managing server files is admin-only (policies: no rule for `assets` except admins-full-access)
const canRead = protect('read', 'assets');
const canDelete = protect('delete', 'assets');
const safeName = (name) => path.basename(String(name ?? ''));

// Get uploads - images
router.get('/api/assets/images/:path', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, `assets/images/${req?.params?.path}`));
  } catch (err) {
    console.log(err);
  }
});

// Get assets - avatars
router.get('/api/assets/avatars/:path', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, `assets/avatars/${req?.params?.path}`));
  } catch (err) {
    console.log(err);
  }
});

// Get assets - covers
router.get('/api/assets/covers/:path', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, `assets/covers/${req?.params?.path}`));
  } catch (err) {
    console.log(err);
  }
});

// Delete File - assets
router.delete('/api/assets/delete/:filename', canDelete, async (req, res) => {
  const filename = safeName(req?.params?.filename);
  const filePath = path.join(__dirname, '../../assets', filename);
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

// Delete File - images
router.delete('/api/assets/delete/:filename', canDelete, async (req, res) => {
  const filename = safeName(req?.params?.filename);
  const filePath = path.join(__dirname, '../../assets/images', filename);
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

// Show Contents assets
router.get('/api/assets/contents', canRead, async (req, res) => {
  const directoryPath = path.join(__dirname, '../../assets');
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
router.get('/api/assets/contents/images', canRead, async (req, res) => {
  const directoryPath = path.join(__dirname, '../../assets/images');
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      res.status(500).send('Error reading directory');
    } else {
      res.json({ files });
    }
  });
});

// Show Contents avatars
router.get('/api/assets/contents/avatars', canRead, async (req, res) => {
  const directoryPath = path.join(__dirname, '../../assets/avatars');
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      res.status(500).send('Error reading directory');
    } else {
      res.json({ files });
    }
  });
});

// Show Contents covers
router.get('/api/assets/contents/covers', canRead, async (req, res) => {
  const directoryPath = path.join(__dirname, '../../assets/covers');
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      res.status(500).send('Error reading directory');
    } else {
      res.json({ files });
    }
  });
});

module.exports = router;
