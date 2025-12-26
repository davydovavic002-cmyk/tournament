// =================================================================
//                    ФИНАЛЬНЫЙ КОД ДЛЯ SERVER.JS
// =================================================================

// ---------------------------------
// 1. ИМПОРТЫ МОДУЛЕЙ
// ---------------------------------
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto'; // Для создания уникальных ID игр
import { Chess } from 'chess.js'; // УБЕДИТЕСЬ, ЧТО ЭТА БИБЛИОТЕКА УСТАНОВЛЕНА (npm install chess.js)

// ---------------------------------
// 2. ИМПОРТЫ ВАШИХ ФАЙЛОВ
// ---------------------------------
 import { Tournament } from './tournament-logic.js'; // Раскомментируйте, когда будет готово
 import { Game } from './game-logic.js'; // Старая логика игры, мы ее встроили в сервер
import {
    addUser,
    findUserByUsername,
    findUserById,
    comparePasswords,
    updateUserStats,
    updateUserLevel
} from './database.js';

// ---------------------------------
// 3. НАСТРОЙКА СЕРВЕРА И ПЕРЕМЕННЫЕ
// ---------------------------------
const JWT_SECRET = 'yoursupersecretandlongkeyforjwt'; // ВАШ СЕКРЕТНЫЙ КЛЮЧ
const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3000;
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Для разработки. В продакшене лучше указать ваш домен.
        methods: ["GET", "POST"]
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------
// 4. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ ИГРЫ
// ---------------------------------
const matchmakingQueue = [];
const activeGames = new Map();
const mainTournament = new Tournament({
    io: io,
    games: activeGames
});
const levels = ['Новичок', 'Любитель', 'Опытный', 'Мастер', 'Грандмастер'];

// ---------------------------------
// 5. MIDDLEWARE (ПРОМЕЖУТОЧНОЕ ПО)
// ---------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const authenticateToken = (req, res, next) => {
    console.log(`\n--- [SERVER LOG] Начало проверки токена для пути: ${req.originalUrl} ---`);
    const authHeader = req.headers['authorization'];
    console.log('[SERVER LOG] 1. Получен заголовок Authorization:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[SERVER LOG] ОШИБКА: Заголовок отсутствует или имеет неверный формат. Отправляю 401.');
        return res.status(401).json({ message: 'Заголовок Authorization отсутствует или неверен' });
    }

    const token = authHeader.split(' ')[1];
    console.log('[SERVER LOG] 2. Извлечен токен:', token);

    if (!token || token === 'null' || token === 'undefined') {
        console.log('[SERVER LOG] ОШИБКА: Токен пустой. Отправляю 401.');
        return res.status(401).json({ message: 'Токен не предоставлен' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('[SERVER LOG] 3. ОШИБКА ВЕРИФИКАЦИИ ТОКЕНА!', err.name, err.message);
            console.log('[SERVER LOG] Отправляю 403 Forbidden. Токен недействителен или истек.');
            return res.status(403).json({ message: 'Токен недействителен или истек', error: err.message });
        }

        console.log('[SERVER LOG] 3. Верификация токена прошла успешно.');
        console.log('[SERVER LOG] 4. Данные из токена (payload):', user);
        req.user = user;
        next();
    });
};

// ---------------------------------
// 6. API РОУТЫ (РЕГИСТРАЦИЯ, ВХОД, ПРОФИЛЬ)
// ---------------------------------
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
        return res.status(400).json({ message: 'Имя пользователя и пароль (мин. 4 символа) обязательны' });
    }
    try {
        const existingUser = await findUserByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: 'Пользователь с таким именем уже существует' });
        }
        await addUser(username, password);
        res.status(201).json({ message: 'Регистрация прошла успешно' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    console.log('Начало обработки /api/login');
    try {
        const { username, password } = req.body;
        console.log(`Получены данные: username=${username}`);
        const user = await findUserByUsername(username);
        console.log('Результат findUserByUsername:', user);

        if (!user) {
            console.log('Пользователь НЕ найден. Отправка 401.');
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        const passwordsMatch = await comparePasswords(password, user.password_hash);
        console.log('Результат comparePasswords:', passwordsMatch);
        if (!passwordsMatch) {
            console.log('Пароли НЕ совпали. Отправка 401.');
            return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
        }

        console.log(`Аутентификация успешна. Генерируем токен для userId: ${user.id}`);
        const payload = { id: user.id, username: user.username };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            message: 'Вход выполнен успешно',
            token: token
        });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА в /api/login:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userProfile = await findUserById(req.user.id);
        if (!userProfile) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        res.json(userProfile);
    } catch (error) {
        console.error('Критическая ошибка в /api/profile:', error);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});

app.post('/api/user/level', authenticateToken, async (req, res) => {
    const { level } = req.body;
    const userId = req.user.id;
    const validLevels = ['Новичок', 'Любитель', 'Профессионал', 'Эксперт', 'Мастер'];

    if (!level || !validLevels.includes(level)) {
        console.error(`Получено недопустимое значение уровня: ${level}`);
        return res.status(400).json({ message: 'Недопустимое значение уровня' });
    }

    try {
        const result = await updateUserLevel(userId, level);
        if (result.success) {
            console.log(`API: Уровень для пользователя ${userId} успешно обновлен на ${level}`);
            res.status(200).json({ message: 'Уровень успешно обновлен', skillLevel: level });
        } else {
            console.error(`API: Не удалось обновить уровень для пользователя ${userId}. Причина: ${result.message}`);
            res.status(404).json({ message: result.message }); // 'Пользователь не найден'
        }
    } catch (error) {
        console.error('Ошибка при вызове updateUserLevel:', error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    res.status(200).json({ message: 'Выход выполнен успешно' });
});

// ---------------------------------
// 7. ЛОГИКА SOCKET.IO
// ---------------------------------


async function handleGameResultUpdate(winnerId, loserId, isDraw) {
    try {
        if (isDraw) {
            await updateUserStats(winnerId, 'draws', 1);
            await updateUserStats(loserId, 'draws', 1);
            console.log(`[Stats] Записана ничья для игроков ${winnerId} и ${loserId}`);
        } else {
            await updateUserStats(winnerId, 'wins', 1);
            await updateUserStats(loserId, 'losses', 1);
            console.log(`[Stats] Победа для ${winnerId}, поражение для ${loserId}`);
        }
    } catch (error) {
        console.error('[Stats] Ошибка при обновлении статистики:', error);
    }
}

function createAndStartGame(player1Socket, player2Socket) {
    const isPlayer1White = Math.random() < 0.5;
    const whitePlayerSocket = isPlayer1White ? player1Socket : player2Socket;
    const blackPlayerSocket = isPlayer1White ? player2Socket : player1Socket;

    const game = new Game({
        io: io,
        playerWhite: { socket: whitePlayerSocket, user: whitePlayerSocket.user },
        playerBlack: { socket: blackPlayerSocket, user: blackPlayerSocket.user },

        onGameResult: handleGameResultUpdate,

        onGameEnd: (gameId) => {
            activeGames.delete(gameId);
            console.log(`[Server] Игра ${gameId} полностью удалена.`);
        },

        onRematchAccepted: (p1, p2) => {
            console.log(`[Server] Запускаем реванш между ${p1.user.username} и ${p2.user.username}`);
            // Рекурсивно вызываем эту же функцию, передавая сокеты игроков
            createAndStartGame(p1.socket, p2.socket);
        }
    });

    activeGames.set(game.getId(), game);
    game.start();
}

// --- MIDDLEWARE ДЛЯ АУТЕНТИФИКАЦИИ SOCKET.IO ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error("Authentication error: No token provided"));
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        socket.user = { id: payload.id, username: payload.username };
        next();
    } catch (err) {
        return next(new Error("Authentication error: Invalid token"));
    }
});

// --- ГЛАВНЫЙ ОБРАБОТЧИК СОБЫТИЙ SOCKET.IO ---
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Подключился: ${socket.user.username} (ID: ${socket.id})`);

    // ----- ЛОГИКА МАТЧМЕЙКИНГА 1 НА 1 -----
    socket.on('findGame', () => {
        console.log(`[Socket.IO] ${socket.user.username} ищет игру.`);

        const indexInQueue = matchmakingQueue.findIndex(s => s.user.id === socket.user.id);
        if (indexInQueue !== -1) {
            matchmakingQueue.splice(indexInQueue, 1);
        }

        matchmakingQueue.push(socket);

        if (matchmakingQueue.length >= 2) {
            console.log('[Matchmaking] Найдены игроки! Создание игры...');
            const player1Socket = matchmakingQueue.shift();
            const player2Socket = matchmakingQueue.shift();

            createAndStartGame(player1Socket, player2Socket);
        }
    });

    socket.on('cancelFindGame', () => {
        const index = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (index !== -1) {
            matchmakingQueue.splice(index, 1);
            console.log(`[Socket.IO] ${socket.user.username} отменил поиск игры.`);
        }
    });


 // Событие для получения текущего состояния при подключении
 // Событие для получения текущего состояния турнира при подключении

// ПРАВИЛЬНО
socket.on('tournament:get_state', () => {
    console.log(`[Socket.IO] ${user.username} запросил состояние турнира.`);
    // Исправляем на getPublicState()
    socket.emit('tournament:update', mainTournament.getPublicState());
});

    // Событие для регистрации в турнире
socket.on('tournament:register', () => {
    console.log(`[Socket.IO] ${socket.user.username} пытается зарегистрироваться в турнире.`);
    try {
        // ПРАВИЛЬНЫЙ ВЫЗОВ: Передаем весь объект socket
        mainTournament.addPlayer(socket);

    } catch (error) {
        // Ваш класс сам отправляет ошибку через socket.emit,
        // но на всякий случай оставим логирование на сервере.
        console.error(`Ошибка при вызове addPlayer для ${socket.user.username}: ${error.message}`);
    }
});

    // Событие для выхода из турнира
socket.on('tournament:leave', () => {
    console.log(`[Socket.IO] Игрок ${socket.user.username} покидает турнир.`);
    try {
        // ПРАВИЛЬНЫЙ ВЫЗОВ: Передаем весь объект socket
        mainTournament.removePlayer(socket);

    } catch (error) {
        console.error(`Ошибка при вызове removePlayer для ${socket.user.username}: ${error.message}`);
    }
});

    // Событие для старта турнира (предположительно от админа)
    socket.on('tournament:start', () => {
        // TODO: Добавить проверку прав администратора, например: if (!isAdmin(socket.user)) return;
        console.log(`[Socket.IO] Получена команда на старт турнира от ${socket.user.username}.`);
        try {
            mainTournament.start();

            // Отправляем обновленное состояние ВСЕМ, чтобы показать начавшиеся матчи
            io.emit('tournament:stateUpdate', mainTournament.getState());
            console.log(`[Socket.IO] Турнир запущен!`);

        } catch (error) {
            console.error(`Ошибка старта турнира: ${error.message}`);
            socket.emit('tournament:error', error.message);
        }
    });

    // Событие для сообщения о результате игры
    socket.on('tournament:reportResult', (result) => {
        // result должен быть объектом, например: { winnerId: '...', loserId: '...' }
        console.log(`[Socket.IO] ${socket.user.username} сообщает о результате игры:`, result);
        try {
            // Простая проверка, что результат сообщает участник матча
            if (socket.user.id !== result.winnerId && socket.user.id !== result.loserId) {
                throw new Error('Вы не можете сообщить результат чужой игры.');
            }

            mainTournament.reportResult(result);

            // Отправляем обновленное состояние ВСЕМ
            io.emit('tournament:stateUpdate', mainTournament.getState());

        } catch (error) {
            console.error(`Ошибка при обработке результата: ${error.message}`);
            socket.emit('tournament:error', error.message);
        }
    });

    // Обработчик отключения
    socket.on('disconnect', () => {
        // Убедимся, что user существует, на случай ошибки подключения
        if (socket.data.user) {
            console.log(`[Socket.IO] Отключился: ${socket.data.user.username}`);
        } else {
            console.log(`[Socket.IO] Отключился анонимный пользователь.`);
        }
    });
        // }

    // ----- ОБЩАЯ ЛОГИКА ДЛЯ ИГР -----
    socket.on('move', (data) => {
        if (!data || !data.roomId || !data.move) {
            console.error(`[Server] Получены неполные данные для хода от ${socket.user.username}`);
            return;
        }
        const game = activeGames.get(data.roomId);

        if (game) {
            game.makeMove(socket.id, data.move);
        } else {
            console.error(`[Server] Ошибка: Попытка сделать ход в игре, которая не найдена: ${data.roomId}`);
            socket.emit('error', 'Игра не найдена. Возможно, она уже завершилась.');
        }
    });

    socket.on('surrender', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleSurrender(socket.id);
        }
    });

    socket.on('rematch', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleRematchRequest(socket.id);
        }
    });

    socket.on('rematchAccepted', (data) => {
        const game = activeGames.get(data.roomId);
        if (game) {
            game.handleRematchAccept(socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Пользователь отключился: ${socket.user.username} (ID: ${socket.id})`);

        const queueIndex = matchmakingQueue.findIndex(s => s.id === socket.id);
        if (queueIndex !== -1) {
            matchmakingQueue.splice(queueIndex, 1);
            console.log(`[Queue] Игрок ${socket.user.username} удален из очереди.`);
        }

        for (const [roomId, game] of activeGames.entries()) {
            const playerColor = game.getPlayerColor(socket.id);

            if (playerColor) {
                console.log(`[Game Abort] Игрок ${socket.user.username} покинул игру ${roomId}. Завершение...`);

                const winnerColor = playerColor === 'white' ? 'black' : 'white';
                const winner = game.players[winnerColor].user;
                const loser = game.players[playerColor].user;

                game.endGame({
                    type: 'abandonment',
                    winner: winner.username,
                    winnerId: winner.id,
                    loserId: loser.id,
                    isDraw: false,
                    reason: `${loser.username} отключился.`
                });
                break;
            }
        }
    });
});
// ---------------------------------
// 8. ЗАПУСК СЕРВЕРА
// ---------------------------------
const startServer = async () => {
    httpServer.listen(port, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    });
};

startServer();
