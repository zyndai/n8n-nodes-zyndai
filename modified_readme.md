# n8n-nodes-zyndai

Custom n8n nodes for integrating with the ZyndAI network and Web3 payment protocols (X402).

## Overview

This package provides custom n8n nodes that enable:
- **Zynd Agent Search**: Discover agents by capabilities on the ZyndAI network
- **Zynd Agent Publisher**: Publish your n8n workflows as agents to the ZyndAI registry
- **X402 Webhook**: Webhook node with built-in Web3 payment verification using the x402 protocol
- **X402 Respond to Webhook**: Custom response node for X402 webhooks with payment settlement

## Features

- Web3 wallet integration using Viem
- X402 payment protocol support for monetizing webhooks
- Multi-network support (Ethereum, Base, Polygon, Arbitrum, Optimism, and testnets)
- Synchronous and asynchronous payment settlement modes
- ZyndAI agent registry integration
- DID-based wallet generation from seed phrases

## Architecture & Build System

This project uses a specialized build architecture to resolve conflicts between n8n's legacy CommonJS environment and modern Web3 libraries (`viem`, `x402`).

### The Challenge
- **n8n** runs on Alpine Linux and requires CommonJS modules. It recursively scans `node_modules` for nodes, which causes crashes if it encounters modern libraries with incompatible exports.
- **Web3 Libraries** (`viem`, `x402`) require modern TypeScript features, native C++ compilation (Python/Make/G++), and "Bundler" module resolution.

### The Solution
We implemented a **Multi-Stage Build with Dependency Isolation**:

1.  **Build Tooling**: We use `esbuild` (via `build/build.js`) to **bundle** all dependencies (except `n8n-workflow`) directly into the output files.
    - This eliminates runtime module resolution errors (like `Cannot find module 'viem/accounts'`) caused by complex package exports in modern libraries.
    - `n8n-workflow` is kept external as it is provided by the n8n runtime.
2.  **Dependency Management**:
    - `jq` is used during Docker build to force `n8n-workflow` installation.
    - Production dependencies are installed in a **hidden directory** (`/home/node/deps`) inside the container.
3.  **Runtime Isolation**:
    - `NODE_PATH` is set to point to the hidden dependencies.
    - Only the compiled `dist` folder is copied to the n8n custom nodes directory.
    - This prevents n8n from scanning `node_modules` and crashing, while still allowing the code to require them at runtime.

### Build Commands
- `npm run build`: Runs `node build/build.js` (esbuild) and `gulp` (assets).
- `docker compose up --build`: Builds the Docker image with the full isolation strategy.

## Prerequisites

- **Node.js** (v18 or higher recommended) and npm
- **Docker** and **Docker Compose** (for Docker installation method)
- **ngrok** (for Docker method - automatically used by run script)
- **n8n** (for manual installation)
- **jq** (for run script - to parse ngrok JSON output)

## Installation

There are two methods to run this project:

### Method 1: Docker (Recommended)

This method uses Docker Compose with ngrok for automatic public URL setup.

#### Start the Infrastructure

```bash
./run.sh
```

This script will:
1. Start ngrok tunnel on port 5678
2. Automatically configure environment variables (.env file)
3. Build and start n8n in Docker with the custom nodes pre-installed
4. Make your n8n instance publicly accessible via ngrok URL

Access n8n Editor at: `http://localhost:5678` (Recommended for editing to avoid ngrok rate limits)
Webhooks are accessible at: `https://xxxx.ngrok-free.app`

#### Stop the Infrastructure

```bash
./stop.sh
```

This will stop and clean up the ngrok process.

### Method 2: Manual Installation

For local development without Docker.

#### Step 1: Install n8n globally

```bash
npm install -g n8n
```

#### Step 2: Build the package

```bash
npm install
npm run build
```

#### Step 3: Link the package globally

```bash
npm link
```

This makes `n8n-nodes-zyndai` available as a global npm package.

#### Step 4: Create custom nodes directory

The location depends on your operating system:

**Linux/macOS:**
```bash
mkdir -p ~/.n8n/custom
cd ~/.n8n/custom
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.n8n\custom"
cd "$env:USERPROFILE\.n8n\custom"
```

**Windows (Command Prompt):**
```cmd
mkdir %USERPROFILE%\.n8n\custom
cd %USERPROFILE%\.n8n\custom
```

#### Step 5: Link the package in the custom directory

```bash
npm link n8n-nodes-zyndai
```

This creates a symlink to your globally linked package.

#### Step 6: Start n8n

```bash
npx n8n start
```

Your custom nodes will now be available in n8n at `http://localhost:5678`

## Configuration

### Environment Variables

Create a `.env` file in the project root. Use `.env.example` as a template:

```bash
cp .env.example .env
```

#### Required Environment Variables:

```env
# Database Configuration
DB_TYPE=sqlite

# N8N Encryption Key
# Get from existing n8n: docker exec -it <container_name> printenv N8N_ENCRYPTION_KEY
# Or generate a new one for fresh installations
N8N_ENCRYPTION_KEY=your_encryption_key_here

# Logging
N8N_LOG_LEVEL=debug
N8N_LOG_OUTPUT=console
CODE_ENABLE_STDOUT=true

# Network Configuration (auto-generated by run.sh for Docker method)
N8N_HOST=
N8N_EDITOR_BASE_URL=
N8N_PUBLIC_API_BASE_URL=
WEBHOOK_URL=
N8N_PORT=5678
N8N_PROTOCOL=https
```

**Note**: For the Docker method, network variables are automatically configured by `run.sh`. For manual installation, configure these according to your setup.

### Credentials Setup in n8n

After starting n8n, configure the following credentials:

#### ZyndAI API Credentials
1. Navigate to **Settings > Credentials** in n8n
2. Create **ZyndAI API** credential:
   - **API URL**: `https://registry.zynd.ai` (default)
   - **Zynd API Key**: Get from [https://dashboard.zynd.ai](https://dashboard.zynd.ai)
   - **N8N API Key**: Generate from n8n **Settings > API**

#### Web3 Wallet Credentials (Optional)
Required for Web3-enabled features. Configure as needed for your use case.

## Available Nodes

### 1. Zynd Agent Search

Search for agents by capabilities on the ZyndAI network.

**Parameters:**
- **Agent Keyword**: Search by name, description, etc.
- **Capabilities**: Multi-select capabilities filter

**Use Case**: Discover and integrate existing agents from the ZyndAI network into your workflows.

### 2. Zynd Agent Publisher

Publish your n8n workflows as agents to the ZyndAI registry.

**Requirements:**
- ZyndAI API credentials configured
- Workflow containing a webhook node

**Use Case**: Share your n8n workflows as reusable agents on the ZyndAI network.

### 3. X402 Webhook

Webhook node with integrated Web3 payment verification using the x402 protocol.

**Parameters:**
- **HTTP Method**: GET, POST, PUT, DELETE, PATCH
- **Path**: Webhook endpoint path
- **Response Mode**:
  - **On Received**: Returns data immediately
  - **Response Node**: Use X402 Respond to Webhook node
  - **Facilitator URL**: x402 payment facilitator endpoint
  - **Server Wallet Address**: Ethereum address to receive payments (0x...)
  - **Price**: Payment amount (e.g., `$0.01`)
  - **Network**: Blockchain network selection

**Supported Networks:**
- Base
- Base Sepolia (Testnet)
- Ethereum
- Ethereum Sepolia (Testnet)
- Polygon
- Arbitrum
- Arbitrum Sepolia (Testnet)
- Optimism

**Options:**
- **Require Payment**: Toggle payment requirement (default: true)
- **Description**: Payment description
- **MIME Type**: Response content type (default: `application/json`)
- **Max Timeout Seconds**: Payment validity duration (default: 60)
- **Include Payment Details**: Add payment info to workflow data
- **Settlement Mode**:
  - **Synchronous**: Settle payment before responding
  - **Asynchronous**: Settle payment in background

**Use Case**: Monetize your webhooks by requiring Web3 payments before processing requests.

### 4. X402 Respond to Webhook

Custom response node for X402 webhooks with payment header support.

**Parameters:**
- **Respond With**: Choose response format (JSON, Binary, All Items, etc.)
- **Response Code**: HTTP status code
- **Response Headers**: Custom headers including X402 payment headers

**Use Case**: Control response behavior for X402 webhooks, especially when using "Response Node" mode.

## Development Scripts

| Script                | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `npm run build`       | Compile TypeScript to JavaScript                                 |
| `npm run build:watch` | Build in watch mode (auto-rebuild on changes)                    |
| `npm run dev`         | Start n8n with nodes loaded and hot reload                       |
| `npm run lint`        | Check code for errors and style issues                           |
| `npm run lint:fix`    | Automatically fix linting issues                                 |
| `npm run release`     | Create a new release                                             |

## Project Structure

```
n8n-nodes-zyndai/
├── nodes/
│   └── Zynd/
│       ├── SearchAgent.node.ts          # Zynd agent search node
│       ├── AgentPublisher.node.ts       # Zynd agent publisher node
│       ├── X402Webhook.node.ts          # X402 webhook with payments
│       ├── X402RespondToWebhook.node.ts # X402 response node
│       └── utils/                       # Utility functions
│           ├── binary.ts                # Binary data handling
│           ├── output.ts                # Output configuration
│           └── utilities.ts             # Helper functions
├── credentials/
│   ├── ZyndAIAPI.credentials.ts         # ZyndAI API credentials
│   └── Web3.credentials.ts              # Web3 wallet credentials
├── icons/                               # Node icons
│   └── zynd.svg                        # ZyndAI logo
├── dist/                                # Compiled JavaScript (auto-generated)
├── Dockerfile                           # Docker build configuration
├── docker-compose.yaml                  # Docker Compose setup
├── run.sh                               # Docker start script
├── stop.sh                              # Docker stop script
├── .env.example                         # Environment template
├── package.json                         # Package configuration
└── README.md                            # This file
```

## Key Dependencies

- **viem** (^2.39.3): Ethereum library for Web3 functionality
- **x402** (^0.7.3): Payment protocol implementation
- **thirdweb** (^5.112.4): Web3 development framework
- **jsonwebtoken** (^9.0.2): JWT token handling
- **basic-auth** (^2.0.1): HTTP basic authentication
- **isbot** (^5.1.32): Bot detection

## Troubleshooting

### Docker Method Issues

**Ngrok URL not found:**
- Ensure ngrok is installed: `ngrok version`
- Check if port 4040 is available (ngrok web interface)
- Review ngrok.log if it exists (created temporarily during startup)

**Docker build fails:**
- Ensure Docker daemon is running
- Try rebuilding: `docker compose build --no-cache`
- Check Docker logs: `docker compose logs`

**Container won't start:**
- Verify `.env` file exists and is properly configured
- Check port 5678 is not already in use
- Ensure sufficient disk space for Docker volumes

**"X-Forwarded-For" Validation Error / 403 Forbidden on Save:**
- This is caused by running behind ngrok without trusting the proxy.
- It can cause **403 Forbidden** errors when saving workflows.
- Fix: Add `N8N_PROXY_HOPS=1` to your environment variables (automatically added by `run.sh` now).

### Manual Installation Issues

**Nodes not appearing in n8n:**
1. Verify build completed successfully: `npm run build`
2. Check `dist/` folder exists and contains compiled files
3. Ensure `npm link` was successful (no errors)
4. Verify symlink exists: `ls -la ~/.n8n/custom/`
5. Restart n8n after building: `npx n8n start`
6. Check package name in `package.json` is `n8n-nodes-zyndai`

**Import/Build errors:**
- Run `npm install` to ensure all dependencies are installed
- Check Node.js version: `node --version` (v18+ recommended)
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Clear TypeScript cache: `rm -rf dist/ && npm run build`

**Credential configuration errors:**
- Verify credentials are properly saved in n8n
- Check API keys are valid and not expired
- Ensure correct API URL format (include https://)
- Generate new N8N API key if needed

**Webhook payment errors:**
- Verify facilitator URL is accessible
- Check wallet address format (must start with 0x)
- Ensure network matches the asset being used
- Verify sufficient funds in payer wallet for testnet

**"Cannot find module" errors:**
- Ensure all peer dependencies are installed
- Check n8n-workflow version compatibility
- Run `npm install` again
- Verify symlink is correctly pointing to package

### Development Issues

**Hot reload not working:**
- Use `npm run build:watch` for auto-rebuild
- Restart n8n if changes don't appear
- Check for TypeScript compilation errors

**Linting errors:**
- Run `npm run lint:fix` to auto-fix common issues
- Check [n8n node development guidelines](https://docs.n8n.io/integrations/creating-nodes/)

## Resources

- **[ZyndAI Documentation](https://docs.zynd.ai)** - ZyndAI platform documentation
- **[ZyndAI Dashboard](https://dashboard.zynd.ai)** - Get API keys and manage agents
- **[n8n Documentation](https://docs.n8n.io)** - n8n workflow automation docs
- **[n8n Node Development](https://docs.n8n.io/integrations/creating-nodes/)** - Guide to building custom nodes
- **[X402 Protocol](https://x402.org)** - Web3 payment protocol documentation
- **[Viem Documentation](https://viem.sh)** - Ethereum library documentation

## Support

For issues and questions:
- **ZyndAI Issues**: Contact via [ZyndAI Dashboard](https://dashboard.zynd.ai)
- **n8n Issues**: Visit [n8n Community Forum](https://community.n8n.io/)
- **Project Issues**: Open an issue on the repository
- **Email**: swapnilshinde9382@gmail.com

## Author

**Swapnil Shinde**
- Email: swapnilshinde9382@gmail.com
- Package: n8n-nodes-zyndai

## License

MIT
