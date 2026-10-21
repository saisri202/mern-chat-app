const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");
const User = require("./models/User");
const Message = require("./models/Message");

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/rooms", require("./routes/roomRoutes"));

app.get("/", (req, res) => {
  res.send("🚀 Chat Server is Running...");
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.user = await User.findById(decoded.id).select("-password");

    if (!socket.user) {
      return next(new Error("User not found"));
    }

    next();
  } catch (error) {
    next(new Error("Invalid token"));
  }
});

io.on("connection", async (socket) => {
  console.log(`✅ User connected: ${socket.user.username}`);

  await User.findByIdAndUpdate(socket.user._id, { isOnline: true });

  io.emit("userOnline", { userId: socket.user._id });

  socket.join(`user_${socket.user._id}`);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);

    socket.to(roomId).emit("userJoined", {
      username: socket.user.username,
      message: `${socket.user.username} joined the room`,
    });
  });

  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);

    socket.to(roomId).emit("userLeft", {
      username: socket.user.username,
    });
  });

  socket.on("sendMessage", async ({ roomId, content }) => {
    try {
      const message = await Message.create({
        room: roomId,
        sender: socket.user._id,
        content,
        type: "room",
      });

      await message.populate("sender", "username avatar");

      io.to(roomId).emit("newMessage", {
        _id: message._id,
        content: message.content,
        sender: {
          _id: socket.user._id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        createdAt: message.createdAt,
      });
    } catch (error) {
      socket.emit("socketError", { message: error.message });
    }
  });

  socket.on("typing", (roomId) => {
    socket.to(roomId).emit("typing", {
      username: socket.user.username,
    });
  });

  socket.on("stopTyping", (roomId) => {
    socket.to(roomId).emit("stopTyping", {
      username: socket.user.username,
    });
  });

  socket.on("sendDirect", async ({ recipientId, content }) => {
    try {
      const message = await Message.create({
        sender: socket.user._id,
        recipient: recipientId,
        content,
        type: "direct",
      });

      await message.populate("sender", "username avatar");

      io.to(`user_${recipientId}`).emit("directMessage", {
        from: {
          _id: socket.user._id,
          username: socket.user.username,
          avatar: socket.user.avatar,
        },
        content: message.content,
        createdAt: message.createdAt,
      });

      socket.emit("directMessage", {
        from: {
          _id: socket.user._id,
          username: "You",
          avatar: socket.user.avatar,
        },
        content: message.content,
        createdAt: message.createdAt,
      });
    } catch (error) {
      socket.emit("socketError", { message: error.message });
    }
  });

  socket.on("disconnect", async () => {
    await User.findByIdAndUpdate(socket.user._id, {
      isOnline: false,
      lastSeen: new Date(),
    });

    io.emit("userOffline", { userId: socket.user._id });

    console.log(`❌ User disconnected: ${socket.user.username}`);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Chat server running on port ${PORT}`);
});