require('./src/models/User');
require('./src/models/Event');
const { config } = require('dotenv');
const { set, connect, connection } = require('mongoose');
const express = require('express');
const cors = require('cors');
const path = require('path');
const uploadRoutes = require('./src/routes/UploadRoutes');
const userRoutes = require('./src/routes/UserRoutes');
const eventRoutes = require('./src/routes/EventRoutes');
config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

set('strictQuery', false);

connect(process.env.MONGODB_URL);

connection.on('connected', () => {
	console.log('Connected to DB.');
});
connection.on('error', (err) => {
	console.log('Error connecting to DB.', err);
});

app.use(uploadRoutes);
app.use(userRoutes);
app.use(eventRoutes);

const port = process.env.PORT || 3005;

app.listen(port, () => {
	console.log(`Listening on port ${port}!`);
});
