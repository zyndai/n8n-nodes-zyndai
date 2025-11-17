FROM n8nio/n8n:latest
USER root


RUN npm install -g typescript gulp rimraf


ENV N8N_CUSTOM_EXTENSIONS="/home/node/n8n-custom-nodes"
ENV NODE_ENV=development
RUN mkdir -p $N8N_CUSTOM_EXTENSIONS/node_modules

COPY . $N8N_CUSTOM_EXTENSIONS/node_modules/n8n-nodes-zyndai


RUN cd $N8N_CUSTOM_EXTENSIONS/node_modules/n8n-nodes-zyndai && \
    npm install && \
    npm run build && \
    npm link && \
    ls -la dist/

RUN npm link n8n-nodes-zyndai

USER node