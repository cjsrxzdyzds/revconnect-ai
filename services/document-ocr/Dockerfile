FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json processor.mjs server.mjs ./
COPY --chown=node:node web ./web
USER node
CMD ["node", "server.mjs"]
