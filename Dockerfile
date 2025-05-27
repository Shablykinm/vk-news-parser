# Используем официальный образ Node.js с Alpine (легковесный)
FROM node:20-alpine

# Устанавливаем системные зависимости для Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    fontconfig \
    tzdata \
    && cp /usr/share/zoneinfo/Europe/Moscow /etc/localtime \
    && echo "Europe/Moscow" > /etc/timezone


# Настраиваем переменные окружения
ENV NODE_ENV=production \
    TZ=Europe/Moscow

# Создаем рабочую директорию
WORKDIR /usr/src/app

# Копируем зависимости
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

RUN chown -R node:node /usr/src/app
USER node

# Запускаем приложение
CMD ["npm", "start"]