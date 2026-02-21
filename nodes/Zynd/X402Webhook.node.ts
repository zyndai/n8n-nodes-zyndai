import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import type {
	IWebhookFunctions,
	IDataObject,
	INodeExecutionData,
	INodeTypeDescription,
	IWebhookResponseData,
	INodeProperties,
} from 'n8n-workflow';
import { BINARY_ENCODING, NodeOperationError, Node } from 'n8n-workflow';
import { pipeline } from 'stream/promises';
import { file as tmpFile } from 'tmp-promise';

import { exact } from 'x402/schemes';
import type { Network, PaymentPayload, PaymentRequirements, Resource } from 'x402/types';
import { settleResponseHeader } from 'x402/types';
import { useFacilitator } from 'x402/verify';
import { processPriceToAtomicAmount } from 'x402/shared';

import { WebhookAuthorizationError } from './utils/webhookError';
import {
	checkResponseModeConfiguration,
	configuredOutputs,
	getResponseCode,
	getResponseData,
	handleFormData,
	isIpAllowed,
	setupOutputConnection,
	validateWebhookAuthentication,
} from './utils/webhookUtils';

// ── Property definitions ─────────────────────────────────────────────

const httpMethodsProperty: INodeProperties = {
	displayName: 'HTTP Method',
	name: 'httpMethod',
	type: 'options',
	options: [
		{ name: 'DELETE', value: 'DELETE' },
		{ name: 'GET', value: 'GET' },
		{ name: 'HEAD', value: 'HEAD' },
		{ name: 'PATCH', value: 'PATCH' },
		{ name: 'POST', value: 'POST' },
		{ name: 'PUT', value: 'PUT' },
	],
	default: 'POST',
	description: 'The HTTP method to listen to',
};

const authenticationProperty: INodeProperties = {
	displayName: 'Authentication',
	name: 'authentication',
	type: 'options',
	options: [
		{ name: 'Basic Auth', value: 'basicAuth' },
		{ name: 'Header Auth', value: 'headerAuth' },
		{ name: 'None', value: 'none' },
	],
	default: 'none',
	description: 'The way to authenticate',
};

const responseModeOptions = [
	{
		name: 'Immediately',
		value: 'onReceived',
		description: 'As soon as this node executes',
	},
	{
		name: 'When Last Node Finishes',
		value: 'lastNode',
		description: 'Returns data of the last-executed node',
	},
	{
		name: "Using 'Respond to Webhook' Node",
		value: 'responseNode',
		description: 'Response defined in that node',
	},
];

const responseModeProperty: INodeProperties = {
	displayName: 'Respond',
	name: 'responseMode',
	type: 'options',
	options: responseModeOptions,
	default: 'onReceived',
	description: 'When and how to respond to the webhook',
	displayOptions: {
		show: {
			'@version': [1, 1.1],
		},
	},
};

const responseModePropertyStreaming: INodeProperties = {
	displayName: 'Respond',
	name: 'responseMode',
	type: 'options',
	options: [
		...responseModeOptions,
		{
			name: 'Streaming',
			value: 'streaming',
			description: 'Returns data in real time from streaming enabled nodes',
		},
	],
	default: 'onReceived',
	description: 'When and how to respond to the webhook',
	displayOptions: {
		hide: {
			'@version': [1, 1.1],
		},
	},
};

const responseDataProperty: INodeProperties = {
	displayName: 'Response Data',
	name: 'responseData',
	type: 'options',
	displayOptions: {
		show: {
			responseMode: ['lastNode'],
		},
	},
	options: [
		{
			name: 'All Entries',
			value: 'allEntries',
			description: 'Returns all the entries of the last node. Always returns an array.',
		},
		{
			name: 'First Entry JSON',
			value: 'firstEntryJson',
			description:
				'Returns the JSON data of the first entry of the last node. Always returns a JSON object.',
		},
		{
			name: 'First Entry Binary',
			value: 'firstEntryBinary',
			description:
				'Returns the binary data of the first entry of the last node. Always returns a binary file.',
		},
		{
			name: 'No Response Body',
			value: 'noData',
			description: 'Returns without a body',
		},
	],
	default: 'firstEntryJson',
	description:
		'What data should be returned. If it should return all items as an array or only the first item as object.',
};

const responseBinaryPropertyNameProperty: INodeProperties = {
	displayName: 'Property Name',
	name: 'responseBinaryPropertyName',
	type: 'string',
	required: true,
	default: 'data',
	displayOptions: {
		show: {
			responseData: ['firstEntryBinary'],
		},
	},
	description: 'Name of the binary property to return',
};

const responseCodeProperty: INodeProperties = {
	displayName: 'Response Code',
	name: 'responseCode',
	type: 'number',
	displayOptions: {
		hide: {
			responseMode: ['responseNode'],
		},
	},
	typeOptions: {
		minValue: 100,
		maxValue: 599,
	},
	default: 200,
	description: 'The HTTP Response code to return',
};

const responseCodeSelector: INodeProperties = {
	displayName: 'Response Code',
	name: 'responseCode',
	type: 'options',
	options: [
		{ name: '200', value: 200, description: 'OK - Request has succeeded' },
		{ name: '201', value: 201, description: 'Created - Request has been fulfilled' },
		{ name: '204', value: 204, description: 'No Content - Request processed, no content returned' },
		{
			name: '301',
			value: 301,
			description: 'Moved Permanently - Requested resource moved permanently',
		},
		{ name: '302', value: 302, description: 'Found - Requested resource moved temporarily' },
		{ name: '304', value: 304, description: 'Not Modified - Resource has not been modified' },
		{ name: '400', value: 400, description: 'Bad Request - Request could not be understood' },
		{ name: '401', value: 401, description: 'Unauthorized - Request requires user authentication' },
		{
			name: '403',
			value: 403,
			description: 'Forbidden - Server understood, but refuses to fulfill',
		},
		{ name: '404', value: 404, description: 'Not Found - Server has not found a match' },
		{ name: 'Custom Code', value: 'customCode', description: 'Write any HTTP code' },
	],
	default: 200,
	description: 'The HTTP response code to return',
};

const responseCodeOption: INodeProperties = {
	displayName: 'Response Code',
	name: 'responseCode',
	placeholder: 'Add Response Code',
	type: 'fixedCollection',
	default: {
		values: {
			responseCode: 200,
		},
	},
	options: [
		{
			name: 'values',
			displayName: 'Values',
			values: [
				responseCodeSelector,
				{
					displayName: 'Code',
					name: 'customCode',
					type: 'number',
					default: 200,
					placeholder: 'e.g. 400',
					typeOptions: {
						minValue: 100,
					},
					displayOptions: {
						show: {
							responseCode: ['customCode'],
						},
					},
				},
			],
		},
	],
	displayOptions: {
		show: {
			'@version': [{ _cnd: { gte: 2 } }],
		},
		hide: {
			'/responseMode': ['responseNode'],
		},
	},
};

const optionsProperty: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
	options: [
		{
			displayName: 'Binary File',
			name: 'binaryData',
			type: 'boolean',
			displayOptions: {
				show: {
					'/httpMethod': ['PATCH', 'PUT', 'POST'],
					'@version': [1],
				},
			},
			default: false,
			description: 'Whether the webhook will receive binary data',
		},
		{
			displayName: 'Put Output File in Field',
			name: 'binaryPropertyName',
			type: 'string',
			default: 'data',
			displayOptions: {
				show: {
					binaryData: [true],
					'@version': [1],
				},
			},
			hint: 'The name of the output binary field to put the file in',
			description:
				'If the data gets received via "Form-Data Multipart" it will be the prefix and a number starting with 0 will be attached to it',
		},
		{
			displayName: 'Field Name for Binary Data',
			name: 'binaryPropertyName',
			type: 'string',
			default: 'data',
			displayOptions: {
				hide: {
					'@version': [1],
				},
			},
			description:
				'The name of the output field to put any binary file data in. Only relevant if binary data is received.',
		},
		{
			displayName: 'Ignore Bots',
			name: 'ignoreBots',
			type: 'boolean',
			default: false,
			description: 'Whether to ignore requests from bots like link previewers and web crawlers',
		},
		{
			displayName: 'IP(s) Allowlist',
			name: 'ipWhitelist',
			type: 'string',
			placeholder: 'e.g. 127.0.0.1, 192.168.1.0/24',
			default: '',
			description:
				'Comma-separated list of allowed IP addresses or CIDR ranges. Leave empty to allow all IPs.',
		},
		{
			displayName: 'No Response Body',
			name: 'noResponseBody',
			type: 'boolean',
			default: false,
			description: 'Whether to send any body in the response',
			displayOptions: {
				hide: {
					rawBody: [true],
				},
				show: {
					'/responseMode': ['onReceived'],
				},
			},
		},
		{
			displayName: 'Raw Body',
			name: 'rawBody',
			type: 'boolean',
			displayOptions: {
				show: {
					'@version': [1],
				},
				hide: {
					binaryData: [true],
					noResponseBody: [true],
				},
			},
			default: false,
			description: 'Raw body (binary)',
		},
		{
			displayName: 'Raw Body',
			name: 'rawBody',
			type: 'boolean',
			displayOptions: {
				hide: {
					noResponseBody: [true],
					'@version': [1],
				},
			},
			default: false,
			description: 'Whether to return the raw body',
		},
		{
			displayName: 'Response Data',
			name: 'responseData',
			type: 'string',
			displayOptions: {
				show: {
					'/responseMode': ['onReceived'],
				},
				hide: {
					noResponseBody: [true],
				},
			},
			default: '',
			placeholder: 'success',
			description: 'Custom response data to send',
		},
		{
			displayName: 'Response Content-Type',
			name: 'responseContentType',
			type: 'string',
			displayOptions: {
				show: {
					'/responseData': ['firstEntryJson'],
					'/responseMode': ['lastNode'],
				},
			},
			default: '',
			placeholder: 'application/xml',
			description:
				'Set a custom content-type to return if another one as the "application/json" should be returned',
		},
		{
			displayName: 'Response Headers',
			name: 'responseHeaders',
			placeholder: 'Add Response Header',
			description: 'Add headers to the webhook response',
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
			},
			default: {},
			options: [
				{
					name: 'entries',
					displayName: 'Entries',
					values: [
						{
							displayName: 'Name',
							name: 'name',
							type: 'string',
							default: '',
							description: 'Name of the header',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							default: '',
							description: 'Value of the header',
						},
					],
				},
			],
		},
		{
			displayName: 'Property Name',
			name: 'responsePropertyName',
			type: 'string',
			displayOptions: {
				show: {
					'/responseData': ['firstEntryJson'],
					'/responseMode': ['lastNode'],
				},
			},
			default: 'data',
			description: 'Name of the property to return the data of instead of the whole JSON',
		},
	],
};

// ── Webhook description ──────────────────────────────────────────────

const defaultWebhookDescription = {
	name: 'default' as const,
	httpMethod: '={{$parameter["httpMethod"] || "POST"}}',
	isFullPath: true,
	responseCode: `={{(${getResponseCode})($parameter)}}`,
	responseMode: '={{$parameter["responseMode"]}}',
	responseData: `={{(${getResponseData})($parameter)}}`,
	responseBinaryPropertyName: '={{$parameter["responseBinaryPropertyName"]}}',
	responseContentType: '={{$parameter["options"]["responseContentType"]}}',
	responsePropertyName: '={{$parameter["options"]["responsePropertyName"]}}',
	responseHeaders: '={{$parameter["options"]["responseHeaders"]}}',
	path: '={{$parameter["path"]}}',
};

// ── Main class ───────────────────────────────────────────────────────

export class X402Webhook extends Node {
	authPropertyName = 'authentication';

	description: INodeTypeDescription = {
		displayName: 'Zynd X402 Webhook',
		icon: { light: 'file:../../icons/zynd.svg', dark: 'file:../../icons/zynd.svg' },
		name: 'zyndX402Webhook',
		group: ['trigger'],
		version: [1, 1.1, 2, 2.1],
		defaultVersion: 2.1,
		subtitle: '={{$parameter["httpMethod"]}} - x402 Payment ({{$parameter["price"]}})',
		description:
			'Starts the workflow when a webhook is called, with optional x402 payment verification',
		eventTriggerDescription: 'Waiting for you to call the Test URL',
		activationMessage: 'You can now make calls to your production webhook URL.',
		defaults: {
			name: 'X402 Webhook',
		},
		supportsCORS: true,
		triggerPanel: {
			header: '',
			executionsHelp: {
				inactive:
					"Webhooks have two modes: test and production. <br /> <br /> <b>Use test mode while you build your workflow</b>. Click the 'listen' button, then make a request to the test URL. The executions will show up in the editor.<br /> <br /> <b>Use production mode to run your workflow automatically</b>. Publish the workflow, then make requests to the production URL. These executions will show up in the executions list, but not in the editor.",
				active:
					'Webhooks have two modes: test and production. <br /> <br /> <b>Use test mode while you build your workflow</b>. Click the \'listen\' button, then make a request to the test URL. The executions will show up in the editor.<br /> <br /> <b>Use production mode to run your workflow automatically</b>. Since the workflow is activated, you can make requests to the production URL. These executions will show up in the <a data-key="executions">executions list</a>, but not in the editor.',
			},
			activationHint:
				"Once you've finished building your workflow, run it without having to click this button by using the production webhook URL.",
		},
		inputs: [],
		outputs: `={{(${configuredOutputs})($parameter)}}`,
		credentials: [
			{
				name: 'httpBasicAuth',
				required: true,
				displayOptions: {
					show: {
						authentication: ['basicAuth'],
					},
				},
			},
			{
				name: 'httpHeaderAuth',
				required: true,
				displayOptions: {
					show: {
						authentication: ['headerAuth'],
					},
				},
			},
		],
		webhooks: [defaultWebhookDescription],
		properties: [
			// x402 notice
			{
				displayName:
					'This node extends the standard Webhook with x402 payment verification. Configure payment settings below or set price to $0 for free access.',
				name: 'x402Notice',
				type: 'notice',
				default: '',
			},

			// Allow multiple HTTP methods
			{
				displayName: 'Allow Multiple HTTP Methods',
				name: 'multipleMethods',
				type: 'boolean',
				default: false,
				isNodeSetting: true,
				description: 'Whether to allow the webhook to listen for multiple HTTP methods',
			},
			{
				...httpMethodsProperty,
				displayOptions: {
					show: {
						multipleMethods: [false],
					},
				},
			},
			{
				displayName: 'HTTP Methods',
				name: 'httpMethod',
				type: 'multiOptions',
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				default: ['GET', 'POST'],
				description: 'The HTTP methods to listen to',
				displayOptions: {
					show: {
						multipleMethods: [true],
					},
				},
			},

			// Path
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'webhook',
				description:
					"The path to listen to, dynamic values could be specified by using ':', e.g. 'your-path/:dynamic-value'. If dynamic values are set 'webhookId' would be prepended to path.",
			},

			// Authentication
			authenticationProperty,

			// Response mode
			responseModeProperty,
			responseModePropertyStreaming,
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
				displayName:
					"Insert a node that supports streaming (e.g. 'AI Agent') and enable streaming to stream directly to the response while the workflow is executed.",
				name: 'webhookStreamingNotice',
				type: 'notice',
				displayOptions: {
					show: {
						responseMode: ['streaming'],
					},
				},
				default: '',
			},
			{
				...responseCodeProperty,
				displayOptions: {
					show: {
						'@version': [1, 1.1],
					},
					hide: {
						responseMode: ['responseNode'],
					},
				},
			},
			responseDataProperty,
			responseBinaryPropertyNameProperty,
			{
				displayName:
					'If you are sending back a response, add a "Content-Type" response header with the appropriate value to avoid unexpected behavior',
				name: 'contentTypeNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						responseMode: ['onReceived'],
					},
				},
			},

			// ── x402 Payment Settings ────────────────────────────────────
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

			// ── Options (merged with x402 options) ───────────────────────
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					...(optionsProperty.options as INodeProperties[]),
					responseCodeOption,
					// x402-specific options
					{
						displayName: 'Require Payment',
						name: 'requirePayment',
						type: 'boolean' as const,
						default: true,
						description: 'Whether to require x402 payment before processing webhook',
					} as INodeProperties,
					{
						displayName: 'Payment Description',
						name: 'paymentDescription',
						type: 'string' as const,
						default: 'Access to webhook endpoint',
						description: 'Description of what the payment is for',
					} as INodeProperties,
					{
						displayName: 'MIME Type',
						name: 'mimeType',
						type: 'string' as const,
						default: 'application/json',
						description: 'Response content type for payment requirements',
					} as INodeProperties,
					{
						displayName: 'Max Timeout Seconds',
						name: 'maxTimeoutSeconds',
						type: 'number' as const,
						default: 60,
						description: 'Maximum time in seconds for payment to be valid',
					} as INodeProperties,
					{
						displayName: 'Include Payment Details',
						name: 'includePaymentDetails',
						type: 'boolean' as const,
						default: true,
						description: 'Whether to include payment details in workflow data',
					} as INodeProperties,
					{
						displayName: 'Settlement Mode',
						name: 'settlementMode',
						type: 'options' as const,
						options: [
							{ name: 'Synchronous', value: 'sync' },
							{ name: 'Asynchronous', value: 'async' },
						],
						default: 'sync',
						description: 'Whether to settle payment synchronously or asynchronously',
					} as INodeProperties,
				].sort((a, b) => {
					const nameA = a.displayName.toUpperCase();
					const nameB = b.displayName.toUpperCase();
					if (nameA < nameB) return -1;
					if (nameA > nameB) return 1;
					return 0;
				}),
			},
		],
	};

	async webhook(context: IWebhookFunctions): Promise<IWebhookResponseData> {
		const { typeVersion: nodeVersion } = context.getNode();
		const responseMode = context.getNodeParameter('responseMode', 'onReceived') as string;

		if (nodeVersion >= 2) {
			try {
				checkResponseModeConfiguration(context);
			} catch (e) {
				// Non-fatal: allow standalone execution
			}
		}

		const options = context.getNodeParameter('options', {}) as {
			binaryData: boolean;
			ignoreBots: boolean;
			rawBody: boolean;
			responseData?: string;
			ipWhitelist?: string;
			requirePayment?: boolean;
			paymentDescription?: string;
			mimeType?: string;
			maxTimeoutSeconds?: number;
			includePaymentDetails?: boolean;
			settlementMode?: string;
		};
		const req = context.getRequestObject();
		const resp = context.getResponseObject();
		const requestMethod = context.getRequestObject().method;

		// ── IP allowlist check ───────────────────────────────────────
		if (!isIpAllowed(options.ipWhitelist, req.ips, req.ip)) {
			resp.writeHead(403);
			resp.end('IP is not allowed to access the webhook!');
			return { noWebhookResponse: true };
		}

		// ── Authentication check ─────────────────────────────────────
		let validationData: IDataObject | undefined;
		try {
			if (options.ignoreBots) {
				const userAgent = req.headers['user-agent'] || '';
				// Simple bot detection
				const botPatterns =
					/bot|crawl|spider|slurp|preview|fetch|curl-image|facebookexternalhit|WhatsApp|Telegram|Discord|Slack/i;
				if (botPatterns.test(userAgent)) {
					throw new WebhookAuthorizationError(403, 'Bot access denied');
				}
			}
			validationData = await this.validateAuth(context);
		} catch (error) {
			if (error instanceof WebhookAuthorizationError) {
				resp.writeHead(error.responseCode, { 'WWW-Authenticate': 'Basic realm="Webhook"' });
				resp.end(error.message);
				return { noWebhookResponse: true };
			}
			throw error;
		}

		// ── x402 Payment verification ────────────────────────────────
		const x402Version = 1;
		const price = context.getNodeParameter('price') as string;
		const requirePayment = options.requirePayment !== false;
		const isZeroPrice = /^\$?0+(\.0+)?$/.test(price.trim());

		const sendJsonResponse = (
			statusCode: number,
			data: any,
			extraHeaders?: Record<string, string>,
		): IWebhookResponseData => {
			const responseHeaders = {
				'Content-Type': 'application/json',
				...extraHeaders,
			};
			resp.writeHead(statusCode, responseHeaders);
			resp.end(JSON.stringify(data));
			return { noWebhookResponse: true };
		};

		if (requirePayment && !isZeroPrice) {
			// Payment required path
			const facilitatorUrl = context.getNodeParameter('facilitatorUrl') as string;
			const serverWalletAddress = context.getNodeParameter('serverWalletAddress') as `0x${string}`;
			const networkName = context.getNodeParameter('network') as Network;
			const paymentDescription =
				(options.paymentDescription as string) || 'Access to webhook endpoint';
			const mimeType = (options.mimeType as string) || 'application/json';
			const maxTimeoutSeconds = (options.maxTimeoutSeconds as number) || 60;
			const settlementMode = (options.settlementMode as string) || 'sync';

			if (!facilitatorUrl) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: 'Facilitator URL is required',
				});
			}

			const { verify, settle } = useFacilitator({ url: facilitatorUrl as Resource });
			const webhookUrl = context.getNodeWebhookUrl('default') as Resource;

			const atomicAmountForAsset = processPriceToAtomicAmount(price, networkName);
			if ('error' in atomicAmountForAsset) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: atomicAmountForAsset.error,
				});
			}

			const { maxAmountRequired, asset } = atomicAmountForAsset;

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
				description: paymentDescription,
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

			const headers = context.getHeaderData();
			const paymentHeader = headers['x-payment'] as string | undefined;

			if (!paymentHeader) {
				return sendJsonResponse(402, {
					x402Version,
					error: 'X-PAYMENT header is required',
					accepts: [paymentRequirements],
				});
			}

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

			try {
				const verifyResponse = await verify(decodedPayment, paymentRequirements);
				if (!verifyResponse.isValid) {
					return sendJsonResponse(402, {
						x402Version,
						error: verifyResponse.invalidReason,
						accepts: [paymentRequirements],
						payer: verifyResponse.payer,
					});
				}
			} catch (error: any) {
				return sendJsonResponse(402, {
					x402Version,
					error: error?.message || 'Payment verification failed',
					accepts: [paymentRequirements],
				});
			}

			// Settlement
			let paymentResponseHeader: string | undefined;
			if (settlementMode === 'async') {
				settle(decodedPayment, paymentRequirements).catch(() => {});
			} else {
				try {
					const settleResponse = await settle(decodedPayment, paymentRequirements);
					paymentResponseHeader = settleResponseHeader(settleResponse);
				} catch (error: any) {
					return sendJsonResponse(402, {
						x402Version,
						error: error?.message || 'Payment settlement failed',
						accepts: [paymentRequirements],
					});
				}
			}

			// If we're in onReceived mode and payment was settled synchronously,
			// add the payment response header. For other modes, we let the standard
			// response flow handle it (but we inject payment data into the output).
			if (paymentResponseHeader && responseMode === 'onReceived') {
				resp.setHeader('X-PAYMENT-RESPONSE', paymentResponseHeader);
			}
		}
		// Payment verified (or not required). Now process the webhook normally.

		const prepareOutput = setupOutputConnection(context, requestMethod, {
			jwtPayload: validationData,
		});

		// Inject x402 payment details into the output if requested
		const injectPaymentDetails = (data: INodeExecutionData): INodeExecutionData => {
			if (requirePayment && !isZeroPrice && options.includePaymentDetails !== false) {
				data.json.payment = {
					verified: true,
					verifiedAt: new Date().toISOString(),
					network: context.getNodeParameter('network') as string,
					price,
					payTo: context.getNodeParameter('serverWalletAddress') as string,
					settlementMode: (options.settlementMode as string) || 'sync',
				};
			}
			return data;
		};

		// ── Binary data handling ─────────────────────────────────────
		if (options.binaryData) {
			return await this.handleBinaryData(context, (data) =>
				prepareOutput(injectPaymentDetails(data)),
			);
		}

		if (req.contentType === 'multipart/form-data') {
			return await handleFormData(context, (data) => prepareOutput(injectPaymentDetails(data)));
		}

		if (nodeVersion > 1 && !req.body && !options.rawBody) {
			try {
				return await this.handleBinaryData(context, (data) =>
					prepareOutput(injectPaymentDetails(data)),
				);
			} catch (error) {
				// Fall through to standard processing
			}
		}

		if (options.rawBody && !req.rawBody) {
			await req.readRawBody();
		}

		const response: INodeExecutionData = {
			json: {
				headers: req.headers,
				params: req.params,
				query: req.query,
				body: req.body,
			},
			binary: options.rawBody
				? {
						data: {
							data: (req.rawBody ?? '').toString(BINARY_ENCODING),
							mimeType: req.contentType ?? 'application/json',
						},
				  }
				: undefined,
		};

		injectPaymentDetails(response);

		// ── Streaming response mode ──────────────────────────────────
		if (responseMode === 'streaming') {
			resp.writeHead(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Transfer-Encoding': 'chunked',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			resp.flushHeaders();

			return {
				noWebhookResponse: true,
				workflowData: prepareOutput(response),
			};
		}

		return {
			webhookResponse: options.responseData,
			workflowData: prepareOutput(response),
		};
	}

	private async validateAuth(context: IWebhookFunctions): Promise<IDataObject | undefined> {
		const result = await validateWebhookAuthentication(context, this.authPropertyName);
		return result as IDataObject | undefined;
	}

	private async handleBinaryData(
		context: IWebhookFunctions,
		prepareOutput: (data: INodeExecutionData) => INodeExecutionData[][],
	): Promise<IWebhookResponseData> {
		const req = context.getRequestObject();
		const options = context.getNodeParameter('options', {}) as IDataObject;

		const binaryFile = await tmpFile({ prefix: 'n8n-webhook-' });

		try {
			await pipeline(req, createWriteStream(binaryFile.path));

			const returnItem: INodeExecutionData = {
				json: {
					headers: req.headers,
					params: req.params,
					query: req.query,
					body: {},
				},
			};

			const stats = await stat(binaryFile.path);
			if (stats.size) {
				const binaryPropertyName = (options.binaryPropertyName ?? 'data') as string;
				const fileName = req.contentDisposition?.filename ?? `upload-${Date.now()}`;
				const binaryData = await context.nodeHelpers.copyBinaryFile(
					binaryFile.path,
					fileName,
					req.contentType ?? 'application/octet-stream',
				);
				returnItem.binary = { [binaryPropertyName]: binaryData };
			}

			return { workflowData: prepareOutput(returnItem) };
		} catch (error) {
			throw new NodeOperationError(context.getNode(), error as Error);
		} finally {
			await binaryFile.cleanup();
		}
	}
}
