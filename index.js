require('./src/models/User');
require('./src/models/Event');
require('./src/models/Memory');
require('./src/models/Notification');
const { config } = require('dotenv');
const { set, connect, connection } = require('mongoose');
const { Server } = require('socket.io');
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const uploadRoutes = require('./src/routes/UploadRoutes');
const userRoutes = require('./src/routes/UserRoutes');
const eventRoutes = require('./src/routes/EventRoutes');
const memoryRoutes = require('./src/routes/MemoryRoutes');
const notificationRoutes = require('./src/routes/NotificationRoutes');
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
app.use(memoryRoutes);
app.use(notificationRoutes);

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: 'http://localhost:3000',
		methods: ['GET', 'POST'],
	},
	pingTimeout: 60000,
});

const port = process.env.PORT || 3005;

io.on('connection', (socket) => {
	socket.on('setup', (userData) => {
		console.log(`User connected: ${userData._id}`);
		socket.join(userData._id);
		socket.emit('connected');
	});

	socket.on('disconnected', () => console.log('You are now disconnected'));

	socket.on('join room', (room) => {
		socket.join(room);
		socket.emit('joined');
	});

	socket.on('typing', (room) => {
		socket.in(room).emit('typing');
	});

	socket.on('stop typing', (room) => {
		socket.in(room).emit('stop typing');
	});

	socket.on('new message', (newMessage) => {
		// console.log('Message', newMessage);
		let chat = newMessage.chat;
		if (!chat.users) return console.log('Chat.users not defined');

		chat.users.forEach((user) => {
			if (user == newMessage.sender._id) return;
			socket.in(user).emit('message received');
		});
	});
});

server.listen(port, () => {
	console.log(`Listening on port ${port}`);
});
