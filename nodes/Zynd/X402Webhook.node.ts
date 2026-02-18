import type {
	IWebhookFunctions,
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { exact } from 'x402/schemes';
import {
	Network,
	PaymentPayload,
	PaymentRequirements,
	Resource,
	settleResponseHeader,
} from 'x402/types';
import { useFacilitator } from 'x402/verify';
import { processPriceToAtomicAmount } from 'x402/shared';

export class X402Webhook implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zynd X402 Webhook',
		name: 'zyndX402Webhook',
		icon: { light: 'file:../../icons/zynd.svg', dark: 'file:../../icons/zynd.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["path"]}} - Payment ({{$parameter["price"]}})',
		description: 'Webhook that requires x402 payment',
		defaults: {
			name: 'X402 Webhook',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				path: 'pay',
			},
		],
		properties: [
			{
				displayName:
					'This node uses x402 protocol for payment verification. Requires facilitator URL.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{ name: 'GET', value: 'GET' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'PATCH', value: 'PATCH' },
				],
				default: 'POST',
				required: true,
				description: 'The HTTP method to listen for',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'On Received',
						value: 'onReceived',
						description: 'Returns data immediately',
					},
					{
						name: 'Response Node',
						value: 'responseNode',
						description: 'Use Respond to Webhook node to return data',
					},
				],
				default: 'onReceived',
				description: 'When to return the data',
			},
			{
				displayName:
					'Insert a \'Respond to Webhook\' node to control when and how you respond. <a href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/" target="_blank">More details</a>',
				name: 'webhookNotice',
				type: 'notice',
				displayOptions: {
					show: {
						responseMode: ['responseNode'],
					},
				},
				default: '',
			},
			{
				displayName: 'Response Code',
				name: 'responseCode',
				type: 'number',
				typeOptions: {
					minValue: 100,
				},
				default: 200,
				description: 'The HTTP response code to return',
				displayOptions: {
					show: {
						responseMode: ['onReceived'],
					},
				},
			},
			{
				displayName: 'Response Data',
				name: 'responseData',
				type: 'options',
				options: [
					{
						name: 'All Entries',
						value: 'allEntries',
						description: 'Returns all the entries of the original webhook request',
					},
					{
						name: 'First Entry JSON',
						value: 'firstEntryJson',
						description: 'Returns the JSON data of the first entry',
					},
					{
						name: 'First Entry Binary',
						value: 'firstEntryBinary',
						description: 'Returns the binary data of the first entry',
					},
					{
						name: 'No Response Body',
						value: 'noData',
						description: 'Returns without a body',
					},
				],
				default: 'firstEntryJson',
				description: 'What data should be returned',
				displayOptions: {
					show: {
						responseMode: ['onReceived'],
					},
				},
			},
			{
				displayName: 'Facilitator URL',
				name: 'facilitatorUrl',
				type: 'string',
				default: 'https://x402.org/facilitator',
				required: true,
				placeholder: 'https://your-facilitator-url.com',
				description: 'The x402 facilitator URL for payment verification',
			},
			{
				displayName: 'Server Wallet Address',
				name: 'serverWalletAddress',
				type: 'string',
				default: '',
				required: true,
				placeholder: '0x1234567890123456789012345678901234567890',
				description: 'The wallet address that will receive payments',
			},
			{
				displayName: 'Price',
				name: 'price',
				type: 'string',
				default: '$0.01',
				required: true,
				placeholder: '$0.01',
				description:
					'Payment price (e.g., $0.01 for USD-denominated). Set to $0 to disable payment and allow free access.',
			},
			{
				displayName: 'Network',
				name: 'network',
				type: 'options',
				options: [
					{ name: 'Base', value: 'base' },
					{ name: 'Base Sepolia (Testnet)', value: 'base-sepolia' },
					{ name: 'Ethereum', value: 'ethereum' },
					{ name: 'Ethereum Sepolia', value: 'sepolia' },
					{ name: 'Polygon', value: 'polygon' },
					{ name: 'Arbitrum', value: 'arbitrum' },
					{ name: 'Arbitrum Sepolia', value: 'arbitrum-sepolia' },
					{ name: 'Optimism', value: 'optimism' },
				],
				default: 'base-sepolia',
				required: true,
				description: 'Blockchain network to accept payments on',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Require Payment',
						name: 'requirePayment',
						type: 'boolean',
						default: true,
						description: 'Whether to require payment before processing webhook',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: 'Access to webhook endpoint',
						description: 'Description of what the payment is for',
					},
					{
						displayName: 'MIME Type',
						name: 'mimeType',
						type: 'string',
						default: 'application/json',
						description: 'Response content type',
					},
					{
						displayName: 'Max Timeout Seconds',
						name: 'maxTimeoutSeconds',
						type: 'number',
						default: 60,
						description: 'Maximum time in seconds for payment to be valid',
					},
					{
						displayName: 'Include Payment Details',
						name: 'includePaymentDetails',
						type: 'boolean',
						default: true,
						description: 'Whether to include payment details in workflow data',
					},
					{
						displayName: 'Settlement Mode',
						name: 'settlementMode',
						type: 'options',
						options: [
							{ name: 'Synchronous', value: 'sync' },
							{ name: 'Asynchronous', value: 'async' },
						],
						default: 'sync',
						description: 'Whether to settle payment synchronously or asynchronously',
					},
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const x402Version = 1;

		try {
			const responseMode = this.getNodeParameter('responseMode', 'onReceived') as string;
			const responseCode = this.getNodeParameter('responseCode', 200) as number;
			// const responseData = this.getNodeParameter('responseData', 'firstEntryJson') as string;

			const sendJsonResponse = (
				statusCode: number,
				data: any,
				headers?: Record<string, string>,
			): IWebhookResponseData => {
				const res = this.getResponseObject();
				const responseHeaders = {
					'Content-Type': 'application/json',
					...headers,
				};
				res.writeHead(statusCode, responseHeaders);
				res.end(JSON.stringify(data));

				return {
					noWebhookResponse: true,
				};
			};

			const options = this.getNodeParameter('options', {}) as IDataObject;
			const requirePayment = options.requirePayment !== false;
			const price = this.getNodeParameter('price') as string;

			// Check if price is effectively zero (e.g., "$0", "$0.00", "0", "0.00", "$0.000")
			const isZeroPrice = /^\$?0+(\.0+)?$/.test(price.trim());

			const bodyData = this.getBodyData();
			const headers = this.getHeaderData();
			const queryData = this.getQueryData() as IDataObject;

			// NO PAYMENT REQUIRED (either explicitly disabled or price is zero/free)
			if (!requirePayment || isZeroPrice) {
				const returnData: IDataObject[] = [
					{
						body: bodyData,
						headers,
						query: queryData,
					},
				];

				// Handle response mode
				if (responseMode === 'responseNode') {
					// Let Respond to Webhook node handle response
					return {
						workflowData: [this.helpers.returnJsonArray(returnData)],
					};
				} else {
					// onReceived mode
					return sendJsonResponse(responseCode, {
						success: true,
						data: returnData[0],
					});
				}
			}

			// Get configuration parameters
			const facilitatorUrl = this.getNodeParameter('facilitatorUrl') as string;
			const serverWalletAddress = this.getNodeParameter('serverWalletAddress') as `0x${string}`;
			const networkName = this.getNodeParameter('network') as Network;

			const description = (options.description as string) || 'Access to webhook endpoint';
			const mimeType = (options.mimeType as string) || 'application/json';
			const maxTimeoutSeconds = (options.maxTimeoutSeconds as number) || 60;
			const settlementMode = (options.settlementMode as string) || 'sync';

			// Validate required parameters
			if (!facilitatorUrl) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: 'Facilitator URL is required',
				});
			}

			// Initialize x402 facilitator
			const { verify, settle } = useFacilitator({ url: facilitatorUrl as Resource });

			// Get webhook URL as resource
			const webhookUrl = this.getNodeWebhookUrl('default') as Resource;

			// Create payment requirements inline
			const atomicAmountForAsset = processPriceToAtomicAmount(price, networkName);
			if ('error' in atomicAmountForAsset) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: atomicAmountForAsset.error,
				});
			}

			const { maxAmountRequired, asset } = atomicAmountForAsset;

			// Check if asset has eip712 property
			if (!('eip712' in asset)) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: 'Asset does not support EIP-712',
				});
			}

			const paymentRequirements: PaymentRequirements = {
				scheme: 'exact',
				network: networkName,
				maxAmountRequired,
				resource: webhookUrl,
				description,
				mimeType,
				payTo: serverWalletAddress,
				maxTimeoutSeconds,
				asset: asset.address,
				outputSchema: undefined,
				extra: {
					name: asset.eip712.name,
					version: asset.eip712.version,
				},
			};

			// Get payment header
			const paymentHeader = headers['x-payment'] as string | undefined;

			if (!paymentHeader) {
				return sendJsonResponse(402, {
					x402Version,
					error: 'X-PAYMENT header is required',
					accepts: [paymentRequirements],
				});
			}

			// Decode payment
			let decodedPayment: PaymentPayload;
			try {
				decodedPayment = exact.evm.decodePayment(paymentHeader);
				decodedPayment.x402Version = x402Version;
			} catch (error: any) {
				return sendJsonResponse(402, {
					x402Version,
					error: error?.message || 'Invalid or malformed payment header',
					accepts: [paymentRequirements],
				});
			}

			// Verify payment
			try {
				const response = await verify(decodedPayment, paymentRequirements);

				if (!response.isValid) {
					return sendJsonResponse(402, {
						x402Version,
						error: response.invalidReason,
						accepts: [paymentRequirements],
						payer: response.payer,
					});
				}
			} catch (error: any) {
				return sendJsonResponse(402, {
					x402Version,
					error: error?.message || 'Payment verification failed',
					accepts: [paymentRequirements],
				});
			}

			// Handle settlement based on mode
			if (settlementMode === 'async') {
				// ASYNCHRONOUS SETTLEMENT
				const paymentDetails = options.includePaymentDetails
					? {
							payment: {
								verified: true,
								verifiedAt: new Date().toISOString(),
								network: networkName,
								price,
								payTo: serverWalletAddress,
								settlementMode: 'async',
							},
					  }
					: {};

				const returnData: IDataObject[] = [
					{
						body: bodyData,
						headers,
						query: queryData,
						...paymentDetails,
					},
				];

				// Settle payment asynchronously (fire and forget)
				settle(decodedPayment, paymentRequirements).catch(() => {});

				// Handle response mode
				if (responseMode === 'responseNode') {
					// Let Respond to Webhook node handle response
					return {
						workflowData: [this.helpers.returnJsonArray(returnData)],
					};
				} else {
					// onReceived mode - send response immediately
					const res = this.getResponseObject();
					res.writeHead(responseCode, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: true,
							message: 'Payment verified',
						}),
					);

					return {
						noWebhookResponse: true,
						workflowData: [this.helpers.returnJsonArray(returnData)],
					};
				}
			} else {
				// SYNCHRONOUS SETTLEMENT
				try {
					const settleResponse = await settle(decodedPayment, paymentRequirements);
					const responseHeader = settleResponseHeader(settleResponse);

					const paymentDetails = options.includePaymentDetails
						? {
								payment: {
									verified: true,
									settled: true,
									settledAt: new Date().toISOString(),
									network: networkName,
									price,
									payTo: serverWalletAddress,
									settlementMode: 'sync',
								},
						  }
						: {};

					const returnData: IDataObject[] = [
						{
							body: bodyData,
							headers,
							query: queryData,
							...paymentDetails,
						},
					];

					// Handle response mode
					if (responseMode === 'responseNode') {
						// Let Respond to Webhook node handle response
						return {
							workflowData: [this.helpers.returnJsonArray(returnData)],
						};
					} else {
						// onReceived mode - send HTTP response with payment details
						const res = this.getResponseObject();
						res.writeHead(responseCode, {
							'Content-Type': 'application/json',
							'X-PAYMENT-RESPONSE': responseHeader,
						});
						res.end(
							JSON.stringify({
								success: true,
								message: 'Payment verified and settled',
							}),
						);

						return {
							noWebhookResponse: true,
							workflowData: [this.helpers.returnJsonArray(returnData)],
						};
					}
				} catch (error: any) {
					return sendJsonResponse(402, {
						x402Version,
						error: error?.message || 'Payment settlement failed',
						accepts: [paymentRequirements],
					});
				}
			}
		} catch (error: any) {
			// ERROR HANDLER - Send error response manually
			const res = this.getResponseObject();
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					error: 'Payment processing error',
					message: error?.message || 'An unexpected error occurred',
				}),
			);

			return {
				noWebhookResponse: true,
			};
		}
	}
}
