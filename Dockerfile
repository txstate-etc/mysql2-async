FROM node:12-alpine
WORKDIR /usr/app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src src
COPY test test
COPY typings typings

ENTRYPOINT [ "npm" ]
CMD [ "run", "mocha", "--silent" ]
