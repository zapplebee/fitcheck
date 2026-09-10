FROM oven/bun:1.3.5

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
RUN bun run build:client

EXPOSE 3000

CMD ["bun", "run", "start"]
