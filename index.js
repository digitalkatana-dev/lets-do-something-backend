require('./src/models/User');
require('./src/models/Profile');
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
const profileRoutes = require('./src/routes/ProfileRoutes');
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
app.use(profileRoutes);
app.use(eventRoutes);
app.use(memoryRoutes);
app.use(notificationRoutes);

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: 'https://www.letsdosomething.net/',
		methods: ['GET', 'POST'],
	},
	pingTimeout: 60000,
});

const activeSockets = new Set();

io.on('connection', (socket) => {
	socket.on('setup', (userData) => {
		console.log(`User connected: ${userData}`);
		socket.join(userData);
		socket.emit('connected');
		activeSockets.add(socket.id);
	});

	socket.on('refresh', (userData) => {
		console.log(`User refreshed: ${userData}`);
		socket.join(userData);
		socket.emit('reconnected');
		activeSockets.add(socket.id);
		console.log('Active Sockets', activeSockets);
	});

	socket.on('pong', () => {
		console.log('Pong!');
	});

	const pingInterval = setInterval(() => {
		if (activeSockets.size === 0) {
			clearInterval(pingInterval);
		} else {
			io.emit('ping');
		}

		console.log('Active Sockets', activeSockets);
	}, 30000);

	socket.on('rsvp', (room) => {
		console.log(room);
		socket.in(room).emit('rsvp received');
	});

	// socket.on('disconnected', () => console.log('You are now disconnected'));

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

	socket.on('disconnect', () => {
		activeSockets.delete(socket.id);
	});

	socket.on('logout', () => {
		if (activeSockets.size > 1) {
			activeSockets.delete(socket.id);
		} else {
			activeSockets.clear();
		}
		console.log('Socket disconnected');
		socket.disconnect();
	});
});

const port = process.env.PORT || 3005;

server.listen(port, () => {
	console.log(`Listening on port ${port}`);
});
