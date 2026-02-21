import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { HDKey, hdKeyToAccount } from 'viem/accounts';

// Safe JSON stringify that replaces circular references with '[Circular]'
function safeStringify(obj: any): string {
	const seen = new WeakSet();
	return JSON.stringify(obj, (_key, value) => {
		if (typeof value === 'object' && value !== null) {
			if (seen.has(value)) {
				return '[Circular]';
			}
			seen.add(value);
		}
		return value;
	});
}

// Deep-clone an object, stripping any circular references
function safeClone(obj: any): any {
	return JSON.parse(safeStringify(obj));
}

export class AgentPublisher implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zynd Agent Publisher',
		name: 'zyndAgentPublisher',
		icon: { light: 'file:../../icons/zynd.svg', dark: 'file:../../icons/zynd.svg' },
		group: ['transform'],
		version: 1,
		description: 'Create and publish your n8n to the ZyndAI network',
		defaults: {
			name: 'Zynd Agent Publisher',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'zyndAiApi',
				required: true,
			},
		],
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('zyndAiApi');
		const apiUrl = credentials.apiUrl as string;

		const n8nApiUrl = this.getInstanceBaseUrl();
		const workflowId = this.getWorkflow();
		let webHookId: string;
		let webhookType: 'NORMAL' | 'X402' = 'NORMAL';
		let webhookPath = 'pay';

		console.log('[AgentPublisher] DEBUG: Starting execute');
		console.log('[AgentPublisher] DEBUG: apiUrl =', apiUrl);
		console.log('[AgentPublisher] DEBUG: n8nApiUrl =', n8nApiUrl);
		console.log('[AgentPublisher] DEBUG: workflowId =', workflowId.id);
		console.log('[AgentPublisher] DEBUG: items.length =', items.length);

		// Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				// Step 1: GET workflow JSON
				console.log('[AgentPublisher] DEBUG: Step 1 - Fetching workflow JSON...');
				let workflowResponse: any;
				try {
					workflowResponse = await this.helpers.httpRequest({
						method: 'GET',
						url: `${n8nApiUrl}api/v1/workflows/${workflowId.id}`,
						headers: {
							Accept: 'application/json',
							'Content-Type': 'application/json',
							'X-N8N-API-KEY': credentials.n8nApiKey as string,
						},
						json: true,
						timeout: 30000,
						returnFullResponse: false,
					});
					console.log('[AgentPublisher] DEBUG: Step 1 OK - typeof:', typeof workflowResponse);
					console.log(
						'[AgentPublisher] DEBUG: Step 1 OK - keys:',
						Object.keys(workflowResponse || {}),
					);
				} catch (e: any) {
					console.log('[AgentPublisher] DEBUG: Step 1 FAILED:', e.message);
					throw e;
				}

				// Step 2: Find webhook node
				console.log('[AgentPublisher] DEBUG: Step 2 - Finding webhook node...');
				try {
					webHookId = workflowResponse.nodes.filter((node: any) => {
						if (node.type === 'CUSTOM.zyndX402Webhook') {
							webhookType = 'X402';
							return true;
						}
						return false;
					})[0].webhookId;
					console.log(
						'[AgentPublisher] DEBUG: Step 2 OK - webhookId:',
						webHookId,
						'type:',
						webhookType,
					);
				} catch {
					throw new Error('Add webhook node to your workflow before publishing the agent.');
				}

				// Step 3: Sanitize workflow data (strip circular refs from httpRequest response)
				console.log('[AgentPublisher] DEBUG: Step 3 - Sanitizing workflow data...');
				const workflowData = safeClone(workflowResponse);
				console.log(
					'[AgentPublisher] DEBUG: Step 3 OK - sanitized keys:',
					Object.keys(workflowData || {}),
				);

				// Step 4: POST to register agent
				console.log('[AgentPublisher] DEBUG: Step 4 - POSTing to', `${apiUrl}/agents/n8n`);
				let registerAgentResponse: any;
				try {
					registerAgentResponse = await this.helpers.httpRequest({
						method: 'POST',
						url: `${apiUrl}/agents/n8n`,
						headers: {
							Accept: 'application/json',
							'Content-Type': 'application/json',
							'X-API-KEY': credentials.apiKey as string,
						},
						body: workflowData,
						json: true,
						timeout: 60000,
						returnFullResponse: false,
					});
					console.log('[AgentPublisher] DEBUG: Step 4 OK - typeof:', typeof registerAgentResponse);
					console.log(
						'[AgentPublisher] DEBUG: Step 4 OK - keys:',
						Object.keys(registerAgentResponse || {}),
					);
					console.log('[AgentPublisher] DEBUG: Step 4 OK - id:', registerAgentResponse?.id);
					console.log(
						'[AgentPublisher] DEBUG: Step 4 OK - seed exists:',
						!!registerAgentResponse?.seed,
					);
				} catch (e: any) {
					console.log('[AgentPublisher] DEBUG: Step 4 FAILED:', e.message);
					console.log(
						'[AgentPublisher] DEBUG: Step 4 FAILED status:',
						e.statusCode || e.response?.status || 'unknown',
					);
					console.log(
						'[AgentPublisher] DEBUG: Step 4 FAILED body:',
						safeStringify(e.response?.data || e.body || 'no body'),
					);
					throw e;
				}

				// Step 5: Derive wallet
				console.log('[AgentPublisher] DEBUG: Step 5 - Deriving wallet...');
				const seed = Buffer.from(registerAgentResponse.seed, 'base64');
				const hdKey = HDKey.fromMasterSeed(seed);
				const account = hdKeyToAccount(hdKey);
				console.log('[AgentPublisher] DEBUG: Step 5 OK - address:', account.address);

				// Step 6: PATCH webhook URL
				if (webHookId) {
					let webhookUrl: string;
					if (webhookType === 'NORMAL') {
						webhookUrl = `${n8nApiUrl}webhook/${webHookId}`;
					} else {
						webhookUrl = `${n8nApiUrl}webhook/${webHookId}/${webhookPath}`;
					}

					console.log('[AgentPublisher] DEBUG: Step 6 - PATCHing webhook URL:', webhookUrl);

					const patchBody = {
						agentId: registerAgentResponse.id,
						httpWebhookUrl: webhookUrl,
					};

					try {
						await this.helpers.httpRequest({
							method: 'PATCH',
							url: `${apiUrl}/agents/update-webhook`,
							headers: {
								Accept: 'application/json',
								'Content-Type': 'application/json',
								'X-API-KEY': credentials.apiKey as string,
							},
							body: patchBody,
							json: true,
							timeout: 30000,
							returnFullResponse: false,
						});
						console.log('[AgentPublisher] DEBUG: Step 6 OK');
					} catch (e: any) {
						console.log('[AgentPublisher] DEBUG: Step 6 FAILED:', e.message);
						throw e;
					}
				}

				// Step 7: Build output
				console.log('[AgentPublisher] DEBUG: Step 7 - Building output...');
				returnData.push({
					json: {
						success: true,
						agentId: registerAgentResponse.id,
						agentDID: registerAgentResponse.didIdentifier,
						message: 'Agent published successfully',
						seed: registerAgentResponse.seed,
						address: account.address,
					},
					pairedItem: { item: i },
				});
				console.log('[AgentPublisher] DEBUG: Step 7 OK - Done for item', i);
			} catch (error: any) {
				// AxiosError contains circular refs (Agent/sockets) — extract a clean message
				const errorMessage = error.message || 'Unknown error occurred';
				const statusCode = error.statusCode || error.response?.status || '';
				const responseBody = error.response?.data;
				const cleanMessage = statusCode
					? `${errorMessage} (HTTP ${statusCode}${
							responseBody
								? ': ' +
								  (typeof responseBody === 'string' ? responseBody : safeStringify(responseBody))
								: ''
					  })`
					: errorMessage;

				console.log('[AgentPublisher] DEBUG: CATCH -', cleanMessage);

				// Handle errors gracefully
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: cleanMessage,
							success: false,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				// Throw a clean Error without circular refs
				throw new Error(cleanMessage);
			}
		}

		console.log('[AgentPublisher] DEBUG: Returning', returnData.length, 'items');
		return [returnData];
	}
}
