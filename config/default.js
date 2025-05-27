module.exports = {
    vk: {
        token: '',      // Токен группы VK
        groupIds: [
            56468672,
            47683898,
            127267864,
            12052944,
            161193561,
            21063186,
            10564356
        ], 
        includeWords: ['ломоносова','шубина','вологодск','маяковского'], 
        excludeWords: [ 
            'реклам',
            'распродаж',
            'скидк',
            'купить',
            'розыгрыш',
            'памятник',
            'наград',
            'призер',
            'призёр',
            'олимпиад',
            'войны',
            'войне'
        ]
    },
    telegram: {
        token: '',     // Токен бота Telegram
        chatId: -1,
        messageThreadId: undefined 
    },
    checkInterval: 2 * 60 * 60 * 1000,
    postsPerGroup: 100,
    retryCount: 5,
    requestDelay: 3000,
    storageFile: './storage.json',
    daysShift: 2,  // 2 - Сегодня и вчера, 1 - сегодня
};