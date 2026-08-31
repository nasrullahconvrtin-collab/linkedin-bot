FROM node:22-alpine

WORKDIR /app

# Copy dashboard package dependencies
COPY dashboard/package*.json ./dashboard/

# Install dependencies inside dashboard directory
RUN cd dashboard && npm install

# Copy all dashboard code & scripts
COPY dashboard ./dashboard

WORKDIR /app/dashboard

# Run the 24/7 Cloud Flow Daemon Worker
CMD ["node", "scripts/cloud_flow_daemon.mjs"]
