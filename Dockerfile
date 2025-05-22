FROM node:20

WORKDIR /whatsapp_chatbot

COPY package.json .

RUN npm install --force

COPY . .

CMD ["node", "index.js"]
