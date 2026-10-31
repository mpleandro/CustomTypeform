FROM node:24-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
