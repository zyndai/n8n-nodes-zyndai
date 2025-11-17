import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class SearchAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zynd Agent Search',
		name: 'zyndAgentSearch',
		icon: { light: 'file:zynd.svg', dark: 'file:zynd.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Search for agents by capabilities on the ZyndAI network',
		defaults: {
			name: 'Zynd Agent Search',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Agent Keyword',
				name: 'agentKeyword',
				type: 'string',
				default: 'assistant',
				placeholder: 'e.g., translation, weather, assistant',
				description: 'Search agent by any keyword (name, description, etc.)',
			},
			{
				displayName: 'Capabilities',
				name: 'capabilities',
				type: 'string',
				typeOptions: {
					multipleValues: true,
					multipleValueButtonText: 'Add Capability',
				},
				default: [],
				placeholder: 'e.g., translation, ai_completion',
				description: 'Specific capabilities to search for. Add one capability per item.',
			},
			{
				displayName: 'Max Results',
				name: 'maxResults',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				description: 'Maximum number of agents to return (1-100)',
			},
			{
				displayName: 'Status Filter',
				name: 'statusFilter',
				type: 'options',
				options: [
					{
						name: 'Active Only',
						value: 'ACTIVE',
					},
					{
						name: 'All Statuses',
						value: 'ALL',
					},
				],
				default: 'ACTIVE',
				description: 'Filter agents by their status',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				// Get parameters for this item
				const capabilitiesArr = this.getNodeParameter('capabilities', i, []) as string[];
				const maxResults = this.getNodeParameter('maxResults', i, 10) as number;
				const keyword = (this.getNodeParameter('agentKeyword', i, '') as string).trim();
				const statusFilter = this.getNodeParameter('statusFilter', i, 'ACTIVE') as string;

				// Build capabilities CSV
				const capabilitiesCsv = capabilitiesArr
					.map(c => c.trim())
					.filter(c => c.length > 0)
					.join(',');

				// Build query string
				const qs: Record<string, any> = {
					limit: maxResults,
					offset: 0,
				};

				// Only add status if not ALL
				if (statusFilter !== 'ALL') {
					qs.status = statusFilter;
				}

				// Add capabilities if provided
				if (capabilitiesCsv.length > 0) {
					qs.capabilities = capabilitiesCsv;
				}

				// Add keyword if provided
				if (keyword.length > 0) {
					qs.keyword = keyword;
				}

				
				// Execute GET request
				const response = await this.helpers.httpRequest({
					method: 'GET',
					url: 'https://registry.shilltube.fun/search/agents',
					qs,
					json: true,
					timeout: 10000,
					returnFullResponse: false,
				});
				this.logger.error(`Searching agents with query: ${JSON.stringify(response)}`);
				
				// Extract only the data we need (avoid circular references)
				const agentsList = Array.isArray(response?.data) ? response.data : [];

				// If no agents found, return appropriate message
				if (agentsList.length === 0) {
					returnData.push({
						json: {
							query: {
								keyword,
								capabilities: capabilitiesArr,
								maxResults,
								statusFilter,
							},
							results: [],
							count: 0,
							message: 'No agents found matching the search criteria',
						},
						pairedItem: { item: i },
					});
					continue;
				}

				// Add summary as first item
				returnData.push({
					json: {
						query: {
							keyword,
							capabilities: capabilitiesArr,
							maxResults,
							statusFilter,
						},
						results: agentsList.map((agent: any) => ({
							id: agent.id,
							name: agent.name || 'Unknown',
							didIdentifier: agent.didIdentifier,
							description: agent.description || '',
							capabilities: agent.capabilities || [],
						})),
						count: agentsList.length,
						timestamp: new Date().toISOString(),
					},
					pairedItem: { item: i },
				});

				// Add each agent as separate item for easy workflow processing
				for (const agent of agentsList) {
					// Create a clean object with only the properties we need
					const cleanAgent = {
						// Agent details
						id: agent.id,
						name: agent.name || 'Unknown',
						didIdentifier: agent.didIdentifier,
						description: agent.description || '',
						capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
						connectionString: agent.connectionString || '',
						mqttUri: agent.mqttUri || '',
						
						// Metadata
						status: agent.status || 'UNKNOWN',
						createdAt: agent.createdAt,
						updatedAt: agent.updatedAt,
						
						// Helper fields for workflow logic
						capabilitiesString: Array.isArray(agent.capabilities) 
							? agent.capabilities.join(', ') 
							: '',
					};

					returnData.push({
						json: cleanAgent, // Use the clean object
						pairedItem: { item: i },
					});
				}

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

		return [returnData];
	}
}