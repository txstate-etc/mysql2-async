FROM node:12-alpine
WORKDIR /usr/app

RUN apk add --update-cache git && rm -rf /var/cache/apk/*

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src src
COPY test test

ENTRYPOINT [ "npm" ]
CMD [ "run", "mocha", "--silent" ]
