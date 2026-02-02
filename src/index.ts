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

    nextRoundAt?: number;
    nextRoundTimer?: NodeJS.Timeout;

    questions: Question[];
    questionIndex: number;
}

const app = express();
app.use(cors({origin: "true", credentials: true}));
app.get("/health", (_,res) => res.json({ok: true}));

const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: true, credentials: true },
});

const rooms = new Map<string, Room>();

const DEMO_QUESTIONS: Question[] = [
  { id: "q1", text: "What is 12 + 30?", answer: "42" },
  { id: "q2", text: "What is the capital of Norway?", answer: "oslo" },
  { id: "q3", text: "What is 9 * 9?", answer: "81" },
];

function pickNextQuestion(room: Room): Question {
    const i = room.questionIndex % room.questions.length;
    return room.questions[i];
}

function advanceQuestion(room: Room){
    room.questionIndex = (room.questionIndex + 1) % room.questions.length;
    room.question = pickNextQuestion(room);
}

function broadCastSnapshot(room: Room) {
    io.to(room.roomId).emit("room:snapshot", toSnapshot(room));
}

function addSystemMessage(room: Room, content: string) {
    const msg: Message = {
        id: crypto.randomUUID(),
        userId: "system",
        username: "System",
        content,
        timestamp: Date.now(),
    };
    room.messages.push(msg);
    io.to(room.roomId).emit("chat:message", msg);
}

function getOrCreateRoom(roomId: string): Room {
    const existing = rooms.get(roomId);
    if (existing) return existing;

    const room: Room = {
        roomId,
        state: "active",
        question: null,

        players: new Map(),
        messages: [],
        winnerUserId: undefined,

        questions: [...DEMO_QUESTIONS],
        questionIndex: 0,
    };
    room.question = pickNextQuestion(room);
    addSystemMessage(room, "Round started");
    addSystemMessage(room, `Question: ${room.question.text}`);
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
        nextRoundAt: room.nextRoundAt,
    };
}

function normalizeAnswer(s: string) {
    return s.trim().toLowerCase();
}

function startNextRound(room: Room) {
    room.state = "active";
    room.winnerUserId = undefined;
    room.nextRoundAt = undefined;

    advanceQuestion(room);
    addSystemMessage(room, "Next round started");
    if(room.question) {
        addSystemMessage(room, `Question: ${room.question.text}`);
    }
}

function scheduleNextRound(room: Room, delayMs: number) {
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    room.nextRoundAt = Date.now() + delayMs;
    room.nextRoundTimer = setTimeout(() => {
        startNextRound(room);
        broadCastSnapshot(room);
    }, delayMs);
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
        broadCastSnapshot(room);
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

                addSystemMessage(room, `${player.username} got it first!`);
                addSystemMessage(room, `Next round in 5 seconds...`);
                scheduleNextRound(room, 5000);
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