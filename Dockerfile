FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./


RUN yarn install --immutable

COPY . .

RUN yarn build # Builds your SvelteKit app into the 'build' directory


FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "build/index.js"]