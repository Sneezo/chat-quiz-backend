export type RoomState = "waiting" | "active" | "finished";

export type Question = {
    id: string;
    text: string;
    answer: string;
}

export type Message = {
    id: string;
    userId: string;
    username: string;
    content: string;
    timestamp: number;
    isCorrect?: boolean;
}

export type Player = {
    userId: string;
    username: string;
    points: number;
}

export type RoomSnapshot = {
    roomId: string;
    state: RoomState;
    question: {id: string; text: string} | null;
    players: Player[];
    messages: Message[];
    winnerUserId?: string;
}

export type ClientToServerEvents = {
    "room:join": (payload: {roomId: string; username: string}) => void;
    "chat:send": (payload: {roomId: string; content: string}) => void;
};

export type ServerToClientEvents = {
    "room:snapshot": (snapshot: RoomSnapshot) => void;
    "chat:message": (message: Message) => void;
    "room:error": (payload: {message: string}) => void;
};

