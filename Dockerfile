FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server/index.ts"]
