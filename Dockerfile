FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @atm/marketplace-mcp build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@atm/marketplace-mcp", "start", "--host", "0.0.0.0", "--port", "3000"]
