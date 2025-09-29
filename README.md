# Steem WebSocket Bridge v2

## Overview
This project is a WebSocket bridge for Steem, designed to facilitate communication between clients and the Steem blockchain. It provides a robust and efficient way to interact with the Steem network.

## Features
- WebSocket-based communication
- Easy deployment with Docker
- Configurable Nginx setup

## File Structure
- `steem-bridge.js`: Main application logic.
- `steem-client.js`: Client for interacting with the Steem blockchain.
- `nginx/nginx.conf`: Nginx configuration file.
- `Dockerfile`: Docker setup for containerized deployment.
- `deploy.ps1` and `deploy.sh`: Deployment scripts for Windows and Unix-based systems.
- `detailed-test.js`, `enhanced-test.js`, `comprehensive-test.js`: Test scripts for various scenarios.

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- Docker
- Git

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Steemblocks/Steem-WebSocket-Bridge-v2.git
   ```
2. Navigate to the project directory:
   ```bash
   cd Steem-WebSocket-Bridge-v2
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application
To start the application, run:
```bash
node steem-bridge.js
```

### Testing
Run the test scripts to ensure everything is working correctly:
```bash
node detailed-test.js
node enhanced-test.js
node comprehensive-test.js
```

### Deployment with Docker
1. Build the Docker image:
   ```bash
   docker build -t steem-websocket-bridge-v2 .
   ```
2. Run the Docker container:
   ```bash
   docker run -d -p 80:80 --name steem-websocket-bridge-v2 steem-websocket-bridge-v2
   ```
   This will start the container and expose the application on port 80.

3. Verify the container is running:
   ```bash
   docker ps
   ```

## Contributing
Contributions are welcome! Please fork the repository and submit a pull request.

## License
This project is licensed under the MIT License. See the LICENSE file for details.