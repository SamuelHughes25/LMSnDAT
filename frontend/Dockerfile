FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# Dev-mode entrypoint, matching backend/Dockerfile's approach (runserver, not
# gunicorn). A production build (`next build` + standalone output) is a
# deployment-phase task, not part of this scaffold — see docs/PROJECT_LOG.md.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
