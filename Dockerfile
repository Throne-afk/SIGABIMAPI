FROM node:22-alpine

WORKDIR /app

# Dependencias del sistema necesarias para compilar xlsx (módulos nativos)
RUN apk add --no-cache python3 make g++

# Instalar todas las dependencias (incluyendo devDependencies para ts-node-dev)
COPY package*.json ./
RUN npm install

# Copiar código fuente
COPY . .

EXPOSE 3001

# Usa el servidor de desarrollo con hot-reload
CMD ["npm", "run", "dev"]
