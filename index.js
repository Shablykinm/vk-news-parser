const { VK } = require('vk-io');
const { Telegraf } = require('telegraf');
const fs = require('fs').promises;
const _ = require('lodash');
const config = require('./config/production');
const TelegramSender = require('./telegram-sender');

const vk = new VK({
    token: config.vk.token,
    apiMode: 'sequential',
    apiLimit: 3
});

const tgBot = new Telegraf(config.telegram.token);

// Инициализация хранилища перенесена в loadStorage()
let storage = null;

// Обновленная функция форматирования текста
const formatText = text => {
    return text
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .join('\n')
        .trim();
};

async function loadStorage() {
    try {
        const data = await fs.readFile(config.storageFile, 'utf8');
        const raw = JSON.parse(data);

        storage = {
            processedPosts: new Map(
                (raw.processedPosts || []).map(item => 
                    Array.isArray(item) 
                        ? [String(item[0]), item[1]] 
                        : [String(item), 0]
                )
            ),
            groups: new Map(
                Object.entries(raw.groups || {}).map(([k, v]) => [String(k), v])
            )
        };

        console.log(`Хранилище загружено:
- Обработано постов: ${storage.processedPosts.size}
- Известных групп: ${storage.groups.size}`);
    } catch (err) {
        storage = {
            processedPosts: new Map(),
            groups: new Map()
        };
        await saveStorage();
        console.log('Инициализировано новое хранилище');
    }
}

async function saveStorage() {
    const data = {
        processedPosts: Array.from(storage.processedPosts.entries()),
        groups: Object.fromEntries(storage.groups)
    };
    await fs.writeFile(config.storageFile, JSON.stringify(data, null, 2));
}

// Работа с VK API
async function getGroupInfo(groupId) {
    const absoluteId = Math.abs(groupId);

    try {
        const response = await vk.api.groups.getById({
            group_id: absoluteId.toString(),
            fields: 'name,screen_name,is_closed,activity'
        });

        if (!response?.groups?.length) {
            console.log(`Группа ${absoluteId} не найдена или доступ запрещен`);
            return null;
        }

        const group = response.groups[0];

        // Убрали проверку на is_closed
        return {
            id: absoluteId,
            name: group.name,
            activity: group.activity,
            isClosed: !!group.is_closed  // Добавили флаг приватности
        };
    } catch (error) {
        console.error(`Ошибка запроса группы ${absoluteId}: ${error.message}`);
        return null;
    }
}

async function getGroupWithRetry(groupId) {
    for (let attempt = 1; attempt <= config.retryCount; attempt++) {
        // Добавляем задержку перед первой попыткой
        if (attempt > 1) {
            await new Promise(r => setTimeout(r, 2000));
        }

        const group = await getGroupInfo(groupId);
        if (group) return group;

        console.log(`Повторная попытка ${attempt}/${config.retryCount}`);
    }
    return null;
}

// Обработка контента
function getPostTextForCheck(post) {
    const text = getFullPostTextForSending(post);
    return text.toLowerCase();
}

// Упростим проверку слов
function hasIncludeWords(text) {
    return config.vk.includeWords.some(word =>
        text.includes(word.toLowerCase()) // Ищем точное вхождение
    );
}

function hasExcludedWords(text) {
    return config.vk.excludeWords.some(word =>
        text.includes(word.toLowerCase())
    );
}

function formatPostDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow'
    });
}

// Обновим функцию проверки
function validatePost(post) {
    const fullText = getPostTextForCheck(post);
    const hasInclude = hasIncludeWords(fullText);
    const hasExcluded = hasExcludedWords(fullText);

    // Получаем дату поста
    const postDate = formatPostDate(post.date);
    const nowDate = formatPostDate(Date.now() / 1000);

    console.log(`[Проверка поста ${post.id}]:`);
    console.log(`- Дата поста: ${postDate} (текущее время: ${nowDate})`);
    console.log(`- Текст: ${fullText.slice(0, 80)}${fullText.length > 80 ? '...' : ''}`);
    console.log(`- Включенные слова: ${hasInclude ? 'НАЙДЕНЫ' : 'нет'}`);
    console.log(`- Исключения: ${hasExcluded ? 'ОБНАРУЖЕНЫ' : 'нет'}`);

    return hasInclude && !hasExcluded;
}


function getFullPostTextForSending(post) {
    let text = post.text || '';

    if (post.copy_history) {
        post.copy_history.forEach(repost => {
            text += '\n' + (repost.text || '');
        });
    }

    if (post.attachments) {
        post.attachments.forEach(attachment => {
            if (attachment[attachment.type]?.text) {
                text += '\n' + attachment[attachment.type].text;
            }
        });
    }

    return text;
}
// Основная логика
async function checkGroup(groupId) {
    const absoluteId = Math.abs(groupId);
    const vkGroupId = -absoluteId;
    const tgSender = new TelegramSender(
        tgBot, 
        config.telegram.chatId,
        config.telegram.messageThreadId  // Добавляем передачу ID топика
    );

    try {
        if (!storage.groups.has(absoluteId)) {
            const group = await getGroupWithRetry(absoluteId);

            if (!group) {
                storage.groups.set(String(absoluteId), `Группа ${absoluteId}`); // Используем строку
                await saveStorage();
                return;
            }

            const groupName = group.isClosed
                ? `[ПРИВАТНАЯ] ${group.name}`
                : group.name;

            storage.groups.set(absoluteId, groupName);
            console.log(group.isClosed
                ? `Обнаружена приватная группа: ${group.name}`
                : `Обновлена группа: ${group.name}`);

            await saveStorage();
        }

        if (storage.groups.get(absoluteId).includes('[ПРИВАТНАЯ]')) {
            console.log(`Пропуск приватной группы ${absoluteId}`);
            return;
        }

        let allItems = [];
        let offset = 0;
        const now = new Date();
        const startOfPeriod = new Date(now);
        startOfPeriod.setDate(now.getDate() - (config.daysShift - 1));
        startOfPeriod.setHours(0, 0, 0, 0);
        const startTime = Math.floor(startOfPeriod.getTime() / 1000);
        let shouldContinue = true;

        while (shouldContinue) {
            try {
                const response = await vk.api.wall.get({
                    owner_id: vkGroupId,
                    count: 100,
                    offset: offset,
                    filter: 'all'
                });

                const items = response.items;
                if (items.length === 0) break;

                // Фильтруем посты по дате
                for (const post of items) {
                    if (post.date < startTime) {
                        shouldContinue = false;
                        break;
                    }
                    allItems.push(post);
                }

                offset += items.length;
                if (items.length < 100 || !shouldContinue) break;

                await new Promise(r => setTimeout(r, 500));
            } catch (error) {
                console.error(`Ошибка при получении постов группы ${absoluteId}: ${error.message}`);
                break;
            }
        }

        const newPosts = allItems.filter(post =>
            !storage.processedPosts.has(String(post.id))  &&
            validatePost(post)
        );

        console.log(`Найдено новых постов: ${newPosts.length}`);

        for (const post of newPosts) {
            try {
                const groupName = storage.groups.get(absoluteId);
                const postLink = `https://vk.com/wall${post.owner_id}_${post.id}`;

                const postTextForSending = getFullPostTextForSending(post);
const formattedPostText = formatText(postTextForSending);

const fullText = [
    `Группа: ${groupName}`,
    formattedPostText ? `Текст:\n${formattedPostText}` : '',
    `Ссылка: ${postLink}`
].filter(part => part.trim() !== '').join('\n\n');

const postData = {
    text: fullText
};

                await tgSender.send(postData, post.id);
                storage.processedPosts.set(String(post.id), post.date);
            } catch (error) {
                console.error(`Ошибка обработки поста ${post.id}: ${error.message}`);
            }
        }

        await saveStorage();
    } catch (error) {
        console.error(`Ошибка обработки группы ${absoluteId}: ${error.message}`);
    }
}


async function checkAllGroups() {
    console.log(`\n=== Начало проверки ${new Date().toLocaleString()} ===`);

    // Очистка старых записей
    const now = Math.floor(Date.now() / 1000);
    const daysAgo = now - (config.daysShift * 86400);
    let removed = 0;
    
    storage.processedPosts.forEach((timestamp, id) => {
        if (timestamp < daysAgo) {
            storage.processedPosts.delete(id);
            removed++;
        }
    });
    
    if (removed > 0) {
        console.log(`Удалено устаревших постов: ${removed}`);
        await saveStorage();
    }

    for (const groupId of config.vk.groupIds) {
        await checkGroup(groupId);
        await new Promise(r => setTimeout(r, config.requestDelay));
    }

    console.log('=== Проверка завершена ===\n');
}

async function refreshGroupNames() {
    console.log('Обновление названий групп...');

    for (const [id, name] of storage.groups) {
        if (name.startsWith('Группа')) {
            const group = await getGroupWithRetry(id);
            if (group) {
                storage.groups.set(id, group.name);
                console.log(`Обновлено: ${group.name}`);
            }
        }
    }

    await saveStorage();
}

// Запуск
(async () => {
    await loadStorage();
    await checkAllGroups();
    setInterval(checkAllGroups, config.checkInterval);
    setInterval(refreshGroupNames, 24 * 60 * 60 * 1000);
    process.on('unhandledRejection', error => {
        console.error('Необработанная ошибка:', error);
    });
})();