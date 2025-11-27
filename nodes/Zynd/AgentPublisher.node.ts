import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { HDKey, hdKeyToAccount } from 'viem/accounts'

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
                required: true
            }
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
        let webhookType: "NORMAL" | "X402" = "NORMAL";
        let webhookPath = "";


        // Process each input item
        for (let i = 0; i < items.length; i++) {
            try {

                // GET request workflow json
                const workflowResponse = await this.helpers.httpRequest({
                    method: 'GET',
                    url: `${n8nApiUrl}api/v1/workflows/${workflowId.id}`,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': credentials.n8nApiKey as string,
                    },
                    json: true,
                    timeout: 10000,
                    returnFullResponse: false,
                });

                this.logger.debug(`==== ${JSON.stringify(workflowResponse)}`)

                try {
                    webHookId = workflowResponse.nodes.filter((node: any) => {
                        if (node.type === 'n8n-nodes-base.webhook' || node.type === 'CUSTOM.x402Webhook') {
                            webhookType = "X402";
                            webhookPath = node.parameters.path;
                            return true;
                        }
                        return false
                    })[0].webhookId;
                } catch {
                    throw new Error('Add webhook node to your workflow before publishing the agent.');
                }

                // POST request to register agent -> uses workflow json to create new agent on zynd
                const registerAgentResponse = await this.helpers.httpRequest({
                    method: 'POST',
                    url: `${apiUrl}/agents/n8n`,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-API-KEY': credentials.apiKey as string
                    },
                    body: workflowResponse,
                    json: true,
                    timeout: 10000,
                    returnFullResponse: false,
                });

                try {
                    const web3creds = await this.getCredentials('web3wallet');
                    const walletSeed = web3creds?.wallet_seed as string;
                    this.logger.error(`Wallet crds: ${JSON.stringify(web3creds)}`);

                    if (registerAgentResponse.seed !== walletSeed) throw new Error('Wallet seed does not match the registered agent seed.');
                } catch {
                    const seed = Buffer.from(registerAgentResponse.seed, 'base64');
                    const hdKey = HDKey.fromMasterSeed(seed);
                    const account = hdKeyToAccount(hdKey);

                    this.logger.error(`Derived Wallet Address: ${n8nApiUrl}api/v1/credentials ${credentials.n8nApiKey}`);

                    await this.helpers.httpRequest({
                        method: 'POST',
                        url: `${n8nApiUrl}api/v1/credentials`,
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'X-N8N-API-KEY': credentials.n8nApiKey as string
                        },
                        body: JSON.stringify({
                            "name": "Wallet Credential",
                            "type": "web3wallet",
                            "data": {
                                "wallet_seed": registerAgentResponse.seed,
                                "wallet_address": account.address
                            }
                        }),
                        json: true,
                        timeout: 10000,
                        returnFullResponse: false,
                    });

                }

                // Extract webhook ID from workflow response and update agent with webhook URL on zynd

                if (webHookId) {
                    let webhookUrl: string;

                    if (webhookType === "NORMAL") {
                        webhookUrl = `${n8nApiUrl}webhook/${webHookId}`;
                    } else {
                        webhookUrl = `${n8nApiUrl}webhook/${webHookId}/${webhookPath}`;
                    }

                    this.logger.error(`======= ${webhookUrl}`)

                    await this.helpers.httpRequest({
                        method: 'POST',
                        url: `${apiUrl}/agents/update-n8n-webhook`,
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'X-API-KEY': credentials.apiKey as string
                        },
                        body: JSON.stringify({
                            "agentId": registerAgentResponse.id,
                            "n8nHttpWebhookUrl": webhookUrl,
                        }),
                        json: true,
                        timeout: 10000,
                        returnFullResponse: false,
                    });

                    this.logger.error(`Updated Webhook for Agent ID: ${registerAgentResponse.id}`);

                }

                returnData.push({
                    json: {
                        success: true,
                        agentId: registerAgentResponse.id,
                        agentDID: registerAgentResponse.didIdentifier,
                        message: 'Agent published successfully',
                    },
                    pairedItem: { item: i },
                });

            } catch (error) {
                // Handle errors gracefully
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message || 'Unknown error occurred',
                            query: {
                                keyword: this.getNodeParameter('agentKeyword', i, ''),
                                capabilities: this.getNodeParameter('capabilities', i, []),
                            },
                            success: false,
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                throw error;
            }
        }

        this.logger.debug(`Returning data: ${JSON.stringify(returnData)}`);

        return [returnData];
    }
}