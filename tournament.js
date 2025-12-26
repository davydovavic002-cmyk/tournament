document.addEventListener('DOMContentLoaded', async () => {
    // 1. Проверяем токен
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        console.log('Токен не найден. Перенаправление на страницу входа.');
        window.location.href = '/login.html';
        return;
    }

    // 2. ОДИН РАЗ получаем данные о пользователе
    let user;
    try {
        const response = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error('Невалидный токен или ошибка сервера');
        }
        user = await response.json();
    } catch (error) {
        console.error('Ошибка аутентификации:', error.message);
        localStorage.removeItem('jwtToken');
        window.location.href = '/login.html';
        return;
    }

    // 3. Настраиваем UI с данными пользователя
    const userStatusDiv = document.getElementById('user-status'); // Убедитесь, что у вас есть <div id="user-status"></div>
    if (userStatusDiv) {
        userStatusDiv.innerHTML = `Вы вошли как: <strong>${user.username}</strong> | <a href="#" id="logout-btn">Выйти</a>`;
        document.getElementById('logout-btn').addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('jwtToken');
            if (socket) socket.disconnect();
            window.location.href = '/index.html';
        });
    }

    // 4. Инициализируем сокет
    const socket = io({
        auth: { token: token }
    });

    // --- Находим элементы на странице ---
    const registerBtn = document.getElementById('registerBtn');
    const tournamentStatusEl = document.getElementById('tournamentstatus');
    const playerCountEl = document.getElementById('playercount');
    const playerListEl = document.getElementById('playerlist');
    const roundNumberEl = document.getElementById('roundnumber');
    const pairingsTableBody = document.querySelector('#pairingstable tbody');
    const standingsTableBody = document.querySelector('#standingstable tbody');

    // --- ИСПРАВЛЕНИЕ ЗДЕСЬ ---
    // Проверяем, нашлась ли кнопка регистрации, прежде чем с ней работать
    if (registerBtn) {
        // Для теста добавим кнопку "Старт"
        const startBtn = document.createElement('button');
        startBtn.textContent = 'Начать турнир (тест)';
        startBtn.style.marginLeft = '10px';
        registerBtn.after(startBtn); // Теперь эта строка в безопасности

        // Назначаем действия на кнопки
        registerBtn.addEventListener('click', () => socket.emit('tournament:register'));
        startBtn.addEventListener('click', () => socket.emit('tournament:start'));
    } else {
        // Если кнопка не найдена, выведем сообщение в консоль, чтобы было легче отлаживать
        console.error("Элемент с id='registerBtn' не найден на странице. Кнопки регистрации и старта не будут работать.");
    }
    // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

 socket.on('game:created', ({ gameId }) => {
        console.log(`Получен сигнал о создании игры ${gameId}, перенаправляем...`);
        window.location.href = `/game.html?id=${gameId}`;
    });
    // Главный обработчик событий от сервера
    socket.on('tournament:stateUpdate', (state) => {
        console.log('Получено обновление состояния:', state);

        tournamentStatusEl.textContent = getTournamentStatusText(state.status);
        roundNumberEl.textContent = state.currentRound || 0;
        playerCountEl.textContent = `(${state.players.length})`;

        playerListEl.innerHTML = '';
        state.players.forEach(player => {
            playerListEl.innerHTML += `<li>${player.username}</li>`;
        });

        // Обновляем состояние кнопки регистрации, только если она есть
        if (registerBtn) {
            const isRegistered = state.players.some(p => p.id === user.id);
            registerBtn.disabled = isRegistered || state.status !== 'waiting';
            registerBtn.textContent = isRegistered ? 'Вы зарегистрированы' : 'Зарегистрироваться на турнир';
        }

        pairingsTableBody.innerHTML = '';
        if (!state.pairings || state.pairings.length === 0) {
            pairingsTableBody.innerHTML = '<tr><td colspan="3">Пары еще не сформированы</td></tr>';
        } else {
            state.pairings.forEach(match => {
                const p1 = match.player1 ? match.player1.username : 'Ожидание';
                const p2 = match.player2 ? match.player2.username : 'BYE (пропуск)';
                const result = match.result || 'не сыграно';
                pairingsTableBody.innerHTML += `<tr><td>${p1}</td><td>${p2}</td><td>${result}</td></tr>`;
            });
        }

        standingsTableBody.innerHTML = '';
        if (!state.standings || state.standings.length === 0) {
            standingsTableBody.innerHTML = '<tr><td colspan="6">Таблица пуста</td></tr>';
        } else {
            state.standings.forEach((player, index) => {
                standingsTableBody.innerHTML += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${player.username}</td>
                        <td>${player.score}</td>
                        <td>${player.wins || 0}</td>
                        <td>${player.draws || 0}</td>
                        <td>${player.losses || 0}</td>
                    </tr>
                `;
            });
        }
    });

    socket.on('tournament:error', (errorMessage) => {
        alert(`Ошибка турнира: ${errorMessage}`);
    });

    socket.on('connect', () => {
        console.log('Успешно подключено к серверу, запрашиваем состояние турнира...');
        socket.emit('tournament:getState');
    });

    socket.on('connect_error', (err) => {
        if (err.message === "Unauthorized") {
            console.error("Сервер отклонил токен. Перенаправление на страницу входа.");
            localStorage.removeItem('jwtToken');
            window.location.href = '/login.html';
        }
    });

    function getTournamentStatusText(status) {
        const statuses = { 'waiting': 'Ожидание регистрации', 'playing': 'Идет игра', 'finished': 'Завершен' };
        return statuses[status] || 'Неизвестно';
    }
});
