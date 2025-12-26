import { Game } from './game-logic.js'; // Убедитесь, что путь правильный
import { randomUUID } from 'crypto';

export class Tournament {
    //                                  V-------------------------------------V
    constructor({ io, games, name = 'Шахматный Турнир', totalRounds = 3 }) {
        this.id = randomUUID();
        this.io = io;
        this.games = games; // <-- ДОБАВЛЕНА ЭТА СТРОКА
        this.name = name;
        this.totalRounds = totalRounds;
        this.currentRound = 0;

        this.players = new Map(); // key: userId, value: playerInfo
        this.activeGames = new Map(); // key: gameId, value: gameInstance
        this.rounds = []; // История раундов
        this.state = 'waiting'; // waiting, playing, finished

        console.log(`[Tournament ${this.id}] Создан новый турнир: ${this.name}`);
    }
    // --- УПРАВЛЕНИЕ ИГРОКАМИ ---

    addPlayer(socket) {
        if (this.players.size >= 8 || this.state !== 'waiting') {
            socket.emit('tournament:error', { message: 'Не удалось присоединиться: турнир полон или уже начался' });
            return false;
        }

        if (this.players.has(socket.user.id)) {
            socket.emit('tournament:error', { message: 'Вы уже в этом турнире' });
            return false;
        }

        const playerInfo = {
            socket: socket,
            user: socket.user,
            score: 0,
            opponentsPlayedIds: new Set()
        };

        this.players.set(socket.user.id, playerInfo);
        socket.join(this.id);
        console.log(`[Tournament ${this.id}] Игрок ${socket.user.username} присоединился. Всего: ${this.players.size}`);

        this.broadcastUpdate();
        return true;
    }

    removePlayer(socket) {
        if (this.players.has(socket.user.id)) {
            this.players.delete(socket.user.id);
            socket.leave(this.id);
            console.log(`[Tournament ${this.id}] Игрок ${socket.user.username} покинул турнир. Всего: ${this.players.size}`);
            this.broadcastUpdate();
        }
    }

    // --- ЛОГИКА ТУРНИРА ---

// Вставьте этот код ВНУТРЬ "export class Tournament { ... }"

    // ==================================
    // === ЛОГИКА УПРАВЛЕНИЯ ТУРНИРОМ ===
    // ==================================

    start() {
        if (this.state !== 'waiting') {
            throw new Error('Турнир уже начался или завершен.');
        }
        if (this.players.size < 2) {
            throw new Error('Недостаточно игроков для начала турнира (минимум 2).');
        }

        console.log(`[Tournament ${this.id}] Запуск турнира...`);
        this.state = 'playing';
        this._startNextRound();
    }


    // Метод для получения сериализуемого состояния турнира
_startNextRound() {
        if (this.state !== 'playing') return;

        this.currentRound++;
        console.log(`[Tournament ${this.id}] Начинается раунд ${this.currentRound}`);

        const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.score - a.score);

        const currentRoundGamesInfo = []; // Переименовал для ясности
        const playersInThisRound = new Set();

        for (const player of sortedPlayers) {
            if (playersInThisRound.has(player.user.id)) {
                continue;
            }

            const opponent = sortedPlayers.find(
                p => p.user.id !== player.user.id && !playersInThisRound.has(p.user.id) && !player.opponentsPlayedIds.has(p.user.id)
            );

            if (opponent) {
                // ================== НАЧАЛО ГЛАВНЫХ ИЗМЕНЕНИЙ ==================

                // 1. Получаем сокеты игроков из сохраненных данных
                const player1Socket = this.io.sockets.sockets.get(player.socketId);
                const player2Socket = this.io.sockets.sockets.get(opponent.socketId);

                // Проверка, что оба игрока онлайн
                if (!player1Socket || !player2Socket) {
                    console.error(`Ошибка создания игры: один из игроков (${player.user.username} или ${opponent.user.username}) не онлайн.`);
                    // Здесь можно обработать ситуацию: например, дать обоим тех. поражение или пересоздать пары.
                    // Пока просто пропускаем пару.
                    continue;
                }

                // 2. Создаем экземпляр НАСТОЯЩЕЙ игры
                const newGame = new Game({
                    players: [player.user, opponent.user],
                    // Вы можете передать и другие параметры, если ваш конструктор Game их поддерживает
                    // например, gameType: 'tournament', timeControl: '10|0'
                });

                // 3. Добавляем игру в ГЛОБАЛЬНЫЙ список игр сервера
                this.games.set(newGame.id, newGame);

                // 4. Добавляем игру во ВНУТРЕННИЙ список активных игр турнира
                this.activeGames.set(newGame.id, newGame);

                // 5. ОТПРАВЛЯЕМ СИГНАЛ ДЛЯ ПЕРЕНАПРАВЛЕНИЯ НА ИГРУ
                console.log(`[Tournament] Создана игра ${newGame.id}. Отправляем редирект игрокам ${player.user.username} и ${opponent.user.username}.`);
                player1Socket.emit('game:created', { gameId: newGame.id });
                player2Socket.emit('game:created', { gameId: newGame.id });

                // =================== КОНЕЦ ГЛАВНЫХ ИЗМЕНЕНИЙ ====================

                // Запоминаем, что они играли друг с другом
                player.opponentsPlayedIds.add(opponent.user.id);
                opponent.opponentsPlayedIds.add(player.user.id);

                // Сохраняем информацию о созданной игре для истории раунда
                currentRoundGamesInfo.push({
                    id: newGame.id,
                    players: [player.user, opponent.user], // Сохраняем user-объекты
                    result: null
                });

                playersInThisRound.add(player.user.id);
                playersInThisRound.add(opponent.user.id);

            } else {
                // Игрок без пары (bye)
                player.score += 1;
                console.log(`[Tournament] Игрок ${player.user.username} получает 1 очко (bye) в раунде ${this.currentRound}.`);
                // Важно: нужно сразу обновить состояние, чтобы игрок увидел свое очко
                setTimeout(() => this.broadcastUpdate(), 500);
            }
        }

        if (currentRoundGamesInfo.length > 0) {
            this.rounds.push({
                round: this.currentRound,
                games: currentRoundGamesInfo
            });
        }

        // Обновляем состояние для всех наблюдателей турнира
        this.broadcastUpdate();

        // Проверяем, не закончился ли турнир
        this._checkRoundCompletion();
    }
}
