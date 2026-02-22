FROM node:22-bookworm

# Install dependencies needed for Electron and native builds
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libx11-dev \
    libxkbfile-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the rest of the project
COPY . .

CMD ["bash"]
