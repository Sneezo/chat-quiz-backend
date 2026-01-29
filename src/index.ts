import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    RoomSnapshot,
    Message,
    Player,
    RoomState,
    Question,
} from "./types";

type Room = {
    roomId: string;
    state: RoomState;
    question: Question | null;
    players: Map<string, Player>;
    messages: Message[];
    winnerUserId?: string;
}

const app = express();
app.use(cors({origin: "true", credentials: true}));
app.get("/health", (_,res) => res.json({ok: true}));

const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: true, credentials: true },
});

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
    const existing = rooms.get(roomId);
    if (existing) return existing;

    const room: Room = {
        roomId,
        state: "active",
        question: { id: "q1", text: "What is 2+5?", answer: "7" },
        players: new Map(),
        messages: [],
        winnerUserId: undefined,
    };
    rooms.set(roomId, room);
    return room;
}

function toSnapshot(room: Room) : RoomSnapshot {
    return {
        roomId: room.roomId,
        state: room.state,
        question: room.question
            ? {id: room.question.id, text: room.question.text} : null,
        players: Array.from(room.players.values()),
        messages: room.messages,
        winnerUserId: room.winnerUserId,
    };
}

function normalizeAnswer(s: string) {
    return s.trim().toLowerCase();
}

io.on("connection", (socket) => {
    const userId = socket.id;

    socket.on("room:join", ({roomId, username}) => {
        if(!roomId || !username) {
            socket.emit("room:error", {message: "roomid and username required"});
            return;
        }
        const room = getOrCreateRoom(roomId);
        socket.join(roomId);

        room.players.set(userId, {userId, username, points: 0});
        socket.emit("room:snapshot", toSnapshot(room));
    });

    socket.on("chat:send", ({roomId, content}) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const player = room.players.get(userId);
        if (!player) return;

        const isCorrect = 
            room.state === "active" &&
            room.question &&
            normalizeAnswer(content) === normalizeAnswer(room.question.answer);

            if(isCorrect && !room.winnerUserId) {
                room.winnerUserId = userId;
                room.state = "finished";
                player.points += 100;
            }

            const msg: Message = {
                id: crypto.randomUUID(),
                userId,
                username: player.username,
                content,
                timestamp: Date.now(),
                isCorrect: isCorrect || undefined,
            };

            room.messages.push(msg);
            io.to(roomId).emit("chat:message", msg);
            io.to(roomId).emit("room:snapshot", toSnapshot(room));
    });

    socket.on("disconnect", () => {
        for (const room of rooms.values()) {
            if(room.players.delete(userId)) {
                io.to(room.roomId).emit("room:snapshot", toSnapshot(room));
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port http://localhost:${PORT}`);
})