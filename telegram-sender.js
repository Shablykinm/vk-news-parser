const config = require('./config/production');

class TelegramSender {
    constructor(bot, chatId, messageThreadId) {
        this.bot = bot;
        this.chatId = chatId;
        this.messageThreadId = messageThreadId;
    }

    async send(postData, postId) {
        let { text } = postData;
        
        text = this.formatText(text);

        const textChunks = this.splitText(text);
        for (const chunk of textChunks) {
            try {
                const options = {
                    disable_web_page_preview: false,
                    disable_notification: true,
                    parse_mode: 'HTML'
                };
                
                if (this.messageThreadId) {
                    options.message_thread_id = this.messageThreadId;
                }

                await this.bot.telegram.sendMessage(
                    this.chatId,
                    chunk,
                    options
                );
                await new Promise(r => setTimeout(r, 200));
            } catch (error) {
                console.error('Ошибка отправки текста:', error.message);
            }
        }
    }

    splitText(text) {
        const chunks = [];
        let remainingText = text.trim();
        
        while (remainingText.length > 0) {
            const chunk = remainingText.substring(0, 4096);
            chunks.push(chunk);
            remainingText = remainingText.substring(chunk.length).trim();
        }

        return chunks;
    }

    formatText(text) {
        const words = config.vk.includeWords;
        if (!words || words.length === 0) {
            return text;
        }

        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const escapeHtml = (unsafe) => {
            return unsafe.replace(/&/g, "&amp;")
                         .replace(/</g, "&lt;")
                         .replace(/>/g, "&gt;");
        };

        let processedText = text;

        // Сортировка слов по длине для правильного вложения тегов
        const sortedWords = [...words].sort((a, b) => b.length - a.length);
        sortedWords.forEach(word => {
            const regex = new RegExp(`(${escapeRegExp(word)})`, 'gi');
            processedText = processedText.replace(regex, '<b><u>$1</u></b>');
        });

        // Экранирование HTML с сохранением тегов форматирования
        const parts = processedText.split(/(<\/?[bu]>)/g);
        const allowedTags = ['<b>', '</b>', '<u>', '</u>'];
        const escapedParts = parts.map(part => {
            return allowedTags.includes(part) ? part : escapeHtml(part);
        });

        return escapedParts.join('');
    }
}

module.exports = TelegramSender;