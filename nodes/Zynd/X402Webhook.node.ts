import type {
	IWebhookFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	MultiPartFormData,
} from 'n8n-workflow';
import { BINARY_ENCODING, NodeConnectionTypes } from 'n8n-workflow';

import { exact } from 'x402/schemes';
import type { Network, PaymentPayload, PaymentRequirements, Resource } from 'x402/types';
import { settleResponseHeader } from 'x402/types';
import { useFacilitator } from 'x402/verify';
import { processPriceToAtomicAmount } from 'x402/shared';

export class X402Webhook implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zynd X402 Webhook',
		name: 'zyndX402Webhook',
		icon: { light: 'file:../../icons/zynd.svg', dark: 'file:../../icons/zynd.svg' },
		group: ['trigger'],
		version: 1,
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
		outputs: [NodeConnectionTypes.Main],
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
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				path: 'pay',
			},
		],
		properties: [
			// x402 notice
			{
				displayName:
					'This node extends the standard Webhook with x402 payment verification. Configure payment settings below or set price to $0 for free access.',
				name: 'x402Notice',
				type: 'notice',
				default: '',
			},
			{
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
				required: true,
				description: 'The HTTP method to listen for',
			},
			// Authentication
			{
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
			},
			// Response mode
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				options: [
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
				],
				default: 'onReceived',
				description: 'When and how to respond to the webhook',
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
					maxValue: 599,
				},
				default: 200,
				description: 'The HTTP response code to return',
				displayOptions: {
					hide: {
						responseMode: ['responseNode'],
					},
				},
			},
			{
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
			},
			{
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

			// ── Options ──────────────────────────────────────────────────
			{
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
							},
						},
						default: false,
						description: 'Whether the webhook will receive binary data',
					},
					{
						displayName: 'Field Name for Binary Data',
						name: 'binaryPropertyName',
						type: 'string',
						default: 'data',
						description:
							'The name of the output field to put any binary file data in. If the data gets received via "Form-Data Multipart" it will be the prefix and a number starting with 0 will be attached to it.',
					},
					{
						displayName: 'Ignore Bots',
						name: 'ignoreBots',
						type: 'boolean',
						default: false,
						description:
							'Whether to ignore requests from bots like link previewers and web crawlers',
					},
					{
						displayName: 'Include Payment Details',
						name: 'includePaymentDetails',
						type: 'boolean',
						default: true,
						description: 'Whether to include payment details in workflow data',
					},
					{
						displayName: 'IP(s) Allowlist',
						name: 'ipWhitelist',
						type: 'string',
						placeholder: 'e.g. 127.0.0.1, 192.168.1.0/24',
						default: '',
						description:
							'Comma-separated list of allowed IP addresses. Leave empty to allow all IPs.',
					},
					{
						displayName: 'Max Timeout Seconds',
						name: 'maxTimeoutSeconds',
						type: 'number',
						default: 60,
						description: 'Maximum time in seconds for payment to be valid',
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
						displayName: 'Payment Description',
						name: 'paymentDescription',
						type: 'string',
						default: 'Access to webhook endpoint',
						description: 'Description of what the payment is for',
					},
					{
						displayName: 'Raw Body',
						name: 'rawBody',
						type: 'boolean',
						displayOptions: {
							hide: {
								noResponseBody: [true],
							},
						},
						default: false,
						description: 'Whether to return the raw body',
					},
					{
						displayName: 'Require Payment',
						name: 'requirePayment',
						type: 'boolean',
						default: true,
						description: 'Whether to require x402 payment before processing webhook',
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
						displayName: 'Response MIME Type',
						name: 'mimeType',
						type: 'string',
						default: 'application/json',
						description: 'Response content type for payment requirements',
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
		const responseMode = this.getNodeParameter('responseMode', 'onReceived') as string;
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const req = this.getRequestObject();
		const resp = this.getResponseObject();

		// ── Helper: send JSON response ───────────────────────────────
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

		// ── IP allowlist check ───────────────────────────────────────
		const ipWhitelist = options.ipWhitelist as string | undefined;
		if (ipWhitelist && ipWhitelist.trim() !== '') {
			const allowedIps = ipWhitelist
				.split(',')
				.map((ip) => ip.trim())
				.filter((ip) => ip.length > 0);
			const clientIp = req.ip;
			const clientIps = req.ips || [];
			const allClientIps = clientIp ? [clientIp, ...clientIps] : clientIps;

			if (!allClientIps.some((ip) => allowedIps.includes(ip))) {
				resp.writeHead(403);
				resp.end('IP is not allowed to access the webhook!');
				return { noWebhookResponse: true };
			}
		}

		// ── Bot detection ────────────────────────────────────────────
		if (options.ignoreBots) {
			const userAgent = req.headers['user-agent'] || '';
			const botPatterns =
				/bot|crawl|spider|slurp|preview|fetch|curl-image|facebookexternalhit|WhatsApp|Telegram|Discord|Slack/i;
			if (botPatterns.test(userAgent)) {
				resp.writeHead(403);
				resp.end('Bot access denied');
				return { noWebhookResponse: true };
			}
		}

		// ── Authentication check ─────────────────────────────────────
		const authentication = this.getNodeParameter('authentication', 'none') as string;
		if (authentication !== 'none') {
			try {
				if (authentication === 'basicAuth') {
					const expectedAuth = await this.getCredentials('httpBasicAuth');
					const authHeader = req.headers.authorization;
					if (!authHeader || !authHeader.startsWith('Basic ')) {
						resp.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Webhook"' });
						resp.end('Authorization is required!');
						return { noWebhookResponse: true };
					}
					const base64Credentials = authHeader.split(' ')[1];
					const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
					const [user, password] = credentials.split(':');
					if (user !== expectedAuth.user || password !== expectedAuth.password) {
						resp.writeHead(403, { 'WWW-Authenticate': 'Basic realm="Webhook"' });
						resp.end('Authorization data is wrong!');
						return { noWebhookResponse: true };
					}
				} else if (authentication === 'headerAuth') {
					const expectedAuth = await this.getCredentials('httpHeaderAuth');
					const headerName = (expectedAuth.name as string).toLowerCase();
					const expectedValue = expectedAuth.value as string;
					const headers = this.getHeaderData();
					if ((headers as IDataObject)[headerName] !== expectedValue) {
						resp.writeHead(403);
						resp.end('Authorization data is wrong!');
						return { noWebhookResponse: true };
					}
				}
			} catch (error) {
				resp.writeHead(500);
				resp.end('No authentication data defined on node!');
				return { noWebhookResponse: true };
			}
		}

		// ── x402 Payment verification ────────────────────────────────
		const x402Version = 1;
		const price = this.getNodeParameter('price') as string;
		const requirePayment = options.requirePayment !== false;
		const isZeroPrice = /^\$?0+(\.0+)?$/.test(price.trim());

		let paymentResponseHeader: string | undefined;

		if (requirePayment && !isZeroPrice) {
			const facilitatorUrl = this.getNodeParameter('facilitatorUrl') as string;
			const serverWalletAddress = this.getNodeParameter('serverWalletAddress') as `0x${string}`;
			const networkName = this.getNodeParameter('network') as Network;
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
			const webhookUrl = this.getNodeWebhookUrl('default') as Resource;

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

			const headers = this.getHeaderData();
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
		}

		// ── Payment verified (or not required). Process webhook data ──

		// Build return data
		const bodyData = this.getBodyData();
		const headers = this.getHeaderData();
		const queryData = this.getQueryData() as IDataObject;

		let webhookUrl = this.getNodeWebhookUrl('default') as string;
		const executionMode = this.getMode() === 'manual' ? 'test' : 'production';
		if (executionMode === 'test') {
			webhookUrl = webhookUrl.replace('/webhook/', '/webhook-test/');
		}

		const returnItem: IDataObject = {
			headers,
			params: this.getParamsData(),
			query: queryData,
			body: bodyData,
			webhookUrl,
			executionMode,
		};

		// Inject payment details
		if (requirePayment && !isZeroPrice && options.includePaymentDetails !== false) {
			returnItem.payment = {
				verified: true,
				verifiedAt: new Date().toISOString(),
				network: this.getNodeParameter('network') as string,
				price,
				payTo: this.getNodeParameter('serverWalletAddress') as string,
				settlementMode: (options.settlementMode as string) || 'sync',
			};
		}

		// ── Handle binary data / file uploads ────────────────────────
		const contentType = req.headers['content-type'] || '';

		if (options.binaryData || contentType.includes('multipart/form-data')) {
			// Multipart form-data with file uploads
			if (contentType.includes('multipart/form-data')) {
				const formReq = req as MultiPartFormData.Request;
				const { data, files } = formReq.body;

				const returnNodeItem: INodeExecutionData = {
					json: {
						...returnItem,
						body: data,
					},
				};

				if (files && Object.keys(files).length) {
					returnNodeItem.binary = {};
					let count = 0;

					for (const key of Object.keys(files)) {
						const processFiles: MultiPartFormData.File[] = [];
						let multiFile = false;
						if (Array.isArray(files[key])) {
							processFiles.push(...files[key]);
							multiFile = true;
						} else {
							processFiles.push(files[key]);
						}

						let fileCount = 0;
						for (const file of processFiles) {
							let binaryPropertyName = key;
							if (binaryPropertyName.endsWith('[]')) {
								binaryPropertyName = binaryPropertyName.slice(0, -2);
							}
							if (!binaryPropertyName.trim().length) {
								binaryPropertyName = `data${count}`;
							} else if (multiFile) {
								binaryPropertyName += fileCount++;
							}
							if (options.binaryPropertyName) {
								binaryPropertyName = `${options.binaryPropertyName}${count}`;
							}

							returnNodeItem.binary![binaryPropertyName] = await this.nodeHelpers.copyBinaryFile(
								file.filepath,
								file.originalFilename ?? file.newFilename,
								file.mimetype,
							);
							count += 1;
						}
					}
				}

				if (responseMode === 'responseNode') {
					return {
						workflowData: [[returnNodeItem]],
					};
				}

				if (paymentResponseHeader) {
					resp.setHeader('X-PAYMENT-RESPONSE', paymentResponseHeader);
				}

				return {
					webhookResponse: options.responseData,
					workflowData: [[returnNodeItem]],
				};
			}

			// Raw binary data
			const binaryPropertyName = (options.binaryPropertyName ?? 'data') as string;
			const returnNodeItem: INodeExecutionData = {
				json: returnItem,
				binary: {},
			};

			if (req.rawBody) {
				returnNodeItem.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
					req.rawBody,
					undefined,
					req.headers['content-type'],
				);
			}

			if (responseMode === 'responseNode') {
				return {
					workflowData: [[returnNodeItem]],
				};
			}

			if (paymentResponseHeader) {
				resp.setHeader('X-PAYMENT-RESPONSE', paymentResponseHeader);
			}

			return {
				webhookResponse: options.responseData,
				workflowData: [[returnNodeItem]],
			};
		}

		// ── Standard JSON/text body handling ──────────────────────────
		const returnNodeItem: INodeExecutionData = {
			json: returnItem,
		};

		// Raw body support
		if (options.rawBody && req.rawBody) {
			returnNodeItem.binary = {
				data: {
					data: req.rawBody.toString(BINARY_ENCODING),
					mimeType: req.headers['content-type'] ?? 'application/json',
				} as any,
			};
		}

		// ── Handle response mode ─────────────────────────────────────
		if (responseMode === 'responseNode') {
			return {
				workflowData: [[returnNodeItem]],
			};
		}

		// onReceived or lastNode mode
		if (options.noResponseBody) {
			if (paymentResponseHeader) {
				resp.setHeader('X-PAYMENT-RESPONSE', paymentResponseHeader);
			}
			return {
				webhookResponse: undefined,
				workflowData: [[returnNodeItem]],
			};
		}

		if (paymentResponseHeader) {
			resp.setHeader('X-PAYMENT-RESPONSE', paymentResponseHeader);
		}

		return {
			webhookResponse: options.responseData,
			workflowData: [[returnNodeItem]],
		};
	}
}
