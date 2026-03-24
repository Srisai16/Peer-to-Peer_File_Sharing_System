# Stage 1: Build the React Frontend and Backend Dependencies
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy the entire codebase into the container
COPY . .

# Navigate to the backend to install packages and trigger the unified build script
WORKDIR /app/backend
RUN npm install
# The backend build script "cd ../frontend && npm install && npm run build" generates the Vite static dist
RUN npm run build

# Stage 2: Production Server
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy ONLY the necessary production files from the builder stage to keep the image lightweight
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/frontend/dist /app/frontend/dist

# Expose the WebSocket signaling server port
EXPOSE 8080

# Configure production environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Start the Node WebSocket Metadata server
WORKDIR /app/backend
CMD ["npm", "start"]
