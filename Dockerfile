# 1. Use Node.js base image
FROM node:18

# 2. Set working directory inside container
WORKDIR /app

# 3. Copy package.json and package-lock.json
COPY package*.json ./

# 4. Install dependencies
RUN npm install

# 5. Copy remaining files
COPY . .

# 6. Expose port (matches your server.js)
EXPOSE 3000

# 7. Start the server
CMD ["node", "server.js"]
