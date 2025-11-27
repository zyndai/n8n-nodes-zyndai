import { createWriteStream } from 'fs';
import { rm, stat } from 'fs/promises';
import { isbot } from 'isbot';
import type {
	IWebhookFunctions,
	IDataObject,
	INodeExecutionData,
	INodeTypeDescription,
	IWebhookResponseData,
	MultiPartFormData,
	INodeProperties,
} from 'n8n-workflow';
import { BINARY_ENCODING, NodeOperationError, Node } from 'n8n-workflow';
import * as a from 'node:assert';
import { pipeline } from 'stream/promises';
import { file as tmpFile } from 'tmp-promise';
import { v4 as uuid } from 'uuid';


import {
	authenticationProperty,
	credentialsProperty,
	defaultWebhookDescription,
	httpMethodsProperty,
	optionsProperty,
	responseBinaryPropertyNameProperty,
	responseCodeOption,
	responseCodeProperty,
	responseDataProperty,
	responseModeProperty,
	responseModePropertyStreaming,
} from './description';
import { WebhookAuthorizationError } from './error';
import {
	checkResponseModeConfiguration,
	configuredOutputs,
	isIpWhitelisted,
	setupOutputConnection,
	validateWebhookAuthentication,
} from './utils/webhook-utils';

// x402 imports
import { exact } from "x402/schemes";
import {
	Network,
	PaymentPayload,
	PaymentRequirements,
	Resource,
	settleResponseHeader,
} from "x402/types";
import { useFacilitator } from "x402/verify";
import { processPriceToAtomicAmount } from "x402/shared";

export class X402Webhook extends Node {
	authPropertyName = 'authentication';

	description: INodeTypeDescription = {
		displayName: 'X402 Webhook',
		icon: { light: 'file:webhook.svg', dark: 'file:webhook.dark.svg' },
		name: 'x402Webhook',
		group: ['trigger'],
		version: [1, 1.1, 2, 2.1],
		defaultVersion: 2.1,
		description: 'Starts the workflow when a webhook is called with optional x402 payment requirement',
		eventTriggerDescription: 'Waiting for you to call the Test URL',
		activationMessage: 'You can now make calls to your production webhook URL.',
		defaults: {
			name: 'X402 Webhook',
		},
		supportsCORS: true,
		usableAsTool: true,
		triggerPanel: {
			header: '',
			executionsHelp: {
				inactive:
					'Webhooks have two modes: test and production. <br /> <br /> <b>Use test mode while you build your workflow</b>. Click the \'listen\' button, then make a request to the test URL. The executions will show up in the editor.<br /> <br /> <b>Use production mode to run your workflow automatically</b>. <a data-key="activate">Activate</a> the workflow, then make requests to the production URL. These executions will show up in the executions list, but not in the editor.',
				active:
					'Webhooks have two modes: test and production. <br /> <br /> <b>Use test mode while you build your workflow</b>. Click the \'listen\' button, then make a request to the test URL. The executions will show up in the editor.<br /> <br /> <b>Use production mode to run your workflow automatically</b>. Since the workflow is activated, you can make requests to the production URL. These executions will show up in the <a data-key="executions">executions list</a>, but not in the editor.',
			},
			activationHint:
				"Once you've finished building your workflow, run it without having to click this button by using the production webhook URL.",
		},

		inputs: [],
		outputs: `={{(${configuredOutputs})($parameter)}}`,
		credentials: credentialsProperty(this.authPropertyName),
		webhooks: [defaultWebhookDescription],
		properties: [
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
					{
						name: 'DELETE',
						value: 'DELETE',
					},
					{
						name: 'GET',
						value: 'GET',
					},
					{
						name: 'HEAD',
						value: 'HEAD',
					},
					{
						name: 'PATCH',
						value: 'PATCH',
					},
					{
						name: 'POST',
						value: 'POST',
					},
					{
						name: 'PUT',
						value: 'PUT',
					},
				],
				default: ['GET', 'POST'],
				description: 'The HTTP methods to listen to',
				displayOptions: {
					show: {
						multipleMethods: [true],
					},
				},
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'webhook',
				description:
					"The path to listen to, dynamic values could be specified by using ':', e.g. 'your-path/:dynamic-value'. If dynamic values are set 'webhookId' would be prepended to path.",
			},
			authenticationProperty(this.authPropertyName),

			// X402 Payment Configuration Section
			{
				displayName: 'Payment Configuration',
				name: 'paymentSection',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Require Payment',
				name: 'requirePayment',
				type: 'boolean',
				default: false,
				description: 'Whether to require x402 payment before processing webhook',
			},
			{
				displayName: 'Facilitator URL',
				name: 'facilitatorUrl',
				type: 'string',
				default: '',
				placeholder: 'https://your-facilitator-url.com',
				description: 'The x402 facilitator URL for payment verification',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},
			{
				displayName: 'Server Wallet Address',
				name: 'serverWalletAddress',
				type: 'string',
				default: '',
				placeholder: '0x1234567890123456789012345678901234567890',
				description: 'The wallet address that will receive payments',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},
			{
				displayName: 'Price',
				name: 'price',
				type: 'string',
				default: '$0.01',
				placeholder: '$0.01',
				description: 'Payment price (e.g., $0.01 for USD-denominated)',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
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
				description: 'Blockchain network to accept payments on',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},
			{
				displayName: 'Payment Description',
				name: 'paymentDescription',
				type: 'string',
				default: 'Access to webhook endpoint',
				description: 'Description of what the payment is for',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
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
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},
			{
				displayName: 'Max Timeout Seconds',
				name: 'maxTimeoutSeconds',
				type: 'number',
				default: 60,
				description: 'Maximum time in seconds for payment to be valid',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},
			{
				displayName: 'Include Payment Details',
				name: 'includePaymentDetails',
				type: 'boolean',
				default: true,
				description: 'Whether to include payment details in workflow data',
				displayOptions: {
					show: {
						requirePayment: [true],
					},
				},
			},

			// Response Configuration
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
					'Insert a node that supports streaming (e.g. \'AI Agent\') and enable streaming to stream directly to the response while the workflow is executed. <a href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/" target="_blank">More details</a>',
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

			{
				...optionsProperty,
				options: [...(optionsProperty.options as INodeProperties[]), responseCodeOption].sort(
					(a, b) => {
						const nameA = a.displayName.toUpperCase();
						const nameB = b.displayName.toUpperCase();
						if (nameA < nameB) return -1;
						if (nameA > nameB) return 1;
						return 0;
					},
				),
			},
		],
	};

	async webhook(context: IWebhookFunctions): Promise<IWebhookResponseData> {
		if (context === undefined) {
			throw new Error(" COntext is null")
		}
		const { typeVersion: nodeVersion, type: nodeType } = context.getNode();
		const responseMode = context.getNodeParameter('responseMode', 'onReceived') as string;
		const requirePayment = context.getNodeParameter('requirePayment', false) as boolean;

		if (nodeVersion >= 2 && (nodeType === 'n8n-nodes-base.x402Webhook' || nodeType.includes('x402Webhook'))) {
			checkResponseModeConfiguration(context);
		}

		const options = context.getNodeParameter('options', {}) as {
			binaryData: boolean;
			ignoreBots: boolean;
			rawBody: boolean;
			responseData?: string;
			ipWhitelist?: string;
		};
		const req = context.getRequestObject();
		const resp = context.getResponseObject();
		const requestMethod = context.getRequestObject().method;

		// IP Whitelist check
		if (!isIpWhitelisted(options.ipWhitelist, req.ips, req.ip)) {
			resp.writeHead(403);
			resp.end('IP is not whitelisted to access the webhook!');
			return { noWebhookResponse: true };
		}

		// Bot detection
		let validationData: IDataObject | undefined;
		try {
			if (options.ignoreBots && isbot(req.headers['user-agent']))
				throw new WebhookAuthorizationError(403);
			validationData = await this.validateAuth(context);
		} catch (error) {
			if (error instanceof WebhookAuthorizationError) {
				resp.writeHead(error.responseCode, { 'WWW-Authenticate': 'Basic realm="Webhook"' });
				resp.end(error.message);
				return { noWebhookResponse: true };
			}
			throw error;
		}

		// X402 PAYMENT PROCESSING
		if (requirePayment) {
			return await this.handleX402Payment(context, requestMethod, validationData, options);
		}

		// STANDARD WEBHOOK PROCESSING (no payment required)
		const prepareOutput = setupOutputConnection(context, requestMethod, {
			jwtPayload: validationData,
		});

		if (options.binaryData) {
			return await this.handleBinaryData(context, prepareOutput);
		}

		if (req.contentType === 'multipart/form-data') {
			return await this.handleFormData(context, prepareOutput);
		}

		if (nodeVersion > 1 && !req.body && !options.rawBody) {
			try {
				return await this.handleBinaryData(context, prepareOutput);
			} catch (error) { }
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

		if (responseMode === 'streaming') {
			const res = context.getResponseObject();

			// Set up streaming response headers
			res.writeHead(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Transfer-Encoding': 'chunked',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});

			// Flush headers immediately
			res.flushHeaders();

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

	private async handleX402Payment(
		context: IWebhookFunctions,
		requestMethod: string,
		validationData: IDataObject | undefined,
		options: any,
	): Promise<IWebhookResponseData> {
		const x402Version = 1;
		const req = context.getRequestObject();
		const resp = context.getResponseObject();
		const responseMode = context.getNodeParameter('responseMode', 'onReceived') as string;

		const sendJsonResponse = (statusCode: number, data: any, headers?: Record<string, string>): IWebhookResponseData => {
			const responseHeaders = {
				'Content-Type': 'application/json',
				...headers,
			};
			resp.writeHead(statusCode, responseHeaders);
			resp.end(JSON.stringify(data));

			return {
				noWebhookResponse: true,
			};
		};

		try {
			// Get payment configuration
			const facilitatorUrl = context.getNodeParameter('facilitatorUrl', '') as string;
			const serverWalletAddress = context.getNodeParameter('serverWalletAddress', '') as `0x${string}`;
			const price = context.getNodeParameter('price', '$0.01') as string;
			const networkName = context.getNodeParameter('network', 'base-sepolia') as Network;
			const paymentDescription = context.getNodeParameter('paymentDescription', 'Access to webhook endpoint') as string;
			const maxTimeoutSeconds = context.getNodeParameter('maxTimeoutSeconds', 60) as number;
			const settlementMode = context.getNodeParameter('settlementMode', 'sync') as string;
			const includePaymentDetails = context.getNodeParameter('includePaymentDetails', true) as boolean;

			// Validate required parameters
			if (!facilitatorUrl || !serverWalletAddress) {
				return sendJsonResponse(500, {
					error: 'Configuration Error',
					details: 'Facilitator URL and Server Wallet Address are required for payment',
				});
			}

			// Initialize x402 facilitator
			const { verify, settle } = useFacilitator({ url: facilitatorUrl as Resource });

			// Get webhook URL as resource
			const webhookUrl = context.getNodeWebhookUrl('default') as Resource;

			// Create payment requirements
			const atomicAmountForAsset = processPriceToAtomicAmount(price, networkName);
			if ("error" in atomicAmountForAsset) {
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
				scheme: "exact",
				network: networkName,
				maxAmountRequired,
				resource: webhookUrl,
				description: paymentDescription,
				mimeType: 'application/json',
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
			const paymentHeader = req.headers['x-payment'] as string | undefined;

			if (!paymentHeader) {
				return sendJsonResponse(402, {
					x402Version,
					error: "X-PAYMENT header is required",
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
					error: error?.message || "Invalid or malformed payment header",
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
					error: error?.message || "Payment verification failed",
					accepts: [paymentRequirements],
				});
			}

			// Setup output connection
			const prepareOutput = setupOutputConnection(context, requestMethod, {
				jwtPayload: validationData,
			});

			// Process request data based on content type
			let requestData: INodeExecutionData;

			if (options.binaryData) {
				const binaryResult = await this.handleBinaryData(context, prepareOutput);
				if (binaryResult.workflowData) {
					requestData = binaryResult.workflowData[0][0];
				} else {
					requestData = {
						json: {
							headers: req.headers,
							params: req.params,
							query: req.query,
							body: req.body,
						},
					};
				}
			} else if (req.contentType === 'multipart/form-data') {
				const formResult = await this.handleFormData(context, prepareOutput);
				if (formResult.workflowData) {
					requestData = formResult.workflowData[0][0];
				} else {
					requestData = {
						json: {
							headers: req.headers,
							params: req.params,
							query: req.query,
							body: req.body,
						},
					};
				}
			} else {
				if (options.rawBody && !req.rawBody) {
					await req.readRawBody();
				}

				requestData = {
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
			}

			// Handle settlement based on mode
			if (settlementMode === 'async') {
				// ASYNCHRONOUS SETTLEMENT
				const paymentDetails = includePaymentDetails
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

				// Merge payment details with request data
				requestData.json = {
					...requestData.json,
					...paymentDetails,
				};

				// Handle response based on responseMode
				if (responseMode === 'responseNode') {
					// Let the Respond to Webhook node handle the response
					return {
						workflowData: prepareOutput(requestData),
					};
				} else if (responseMode === 'streaming') {
					// Set up streaming response
					resp.writeHead(200, {
						'Content-Type': 'application/json; charset=utf-8',
						'Transfer-Encoding': 'chunked',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					});
					resp.flushHeaders();

					return {
						noWebhookResponse: true,
						workflowData: prepareOutput(requestData),
					};
				} else {
					// onReceived mode - send response immediately
					resp.writeHead(200, { 'Content-Type': 'application/json' });
					resp.end(JSON.stringify({
						success: true,
						message: 'Payment verified',
					}));
				}

				// Settle payment asynchronously
				settle(decodedPayment, paymentRequirements)
					.then((settleResponse) => {
						const responseHeader = settleResponseHeader(settleResponse);
						context.logger.info('Payment settled asynchronously', { responseHeader });
					})
					.catch((error) => {
						context.logger.error('Async payment settlement failed', { error: error.message });
					});

				return {
					noWebhookResponse: true,
					workflowData: prepareOutput(requestData),
				};

			} else {
				// SYNCHRONOUS SETTLEMENT
				try {
					const settleResponse = await settle(decodedPayment, paymentRequirements);
					const responseHeader = settleResponseHeader(settleResponse);

					const paymentDetails = includePaymentDetails
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

					// Merge payment details with request data
					requestData.json = {
						...requestData.json,
						...paymentDetails,
					};

					// Handle response based on responseMode
					if (responseMode === 'responseNode') {
						// Let the Respond to Webhook node handle the response
						return {
							workflowData: prepareOutput(requestData),
						};
					} else if (responseMode === 'streaming') {
						// Set up streaming response with payment response header
						resp.writeHead(200, {
							'Content-Type': 'application/json; charset=utf-8',
							'Transfer-Encoding': 'chunked',
							'Cache-Control': 'no-cache',
							Connection: 'keep-alive',
							'X-PAYMENT-RESPONSE': responseHeader,
						});
						resp.flushHeaders();

						return {
							noWebhookResponse: true,
							workflowData: prepareOutput(requestData),
						};
					} else {
						// onReceived mode - send HTTP response with payment details
						resp.writeHead(200, {
							'Content-Type': 'application/json',
							'X-PAYMENT-RESPONSE': responseHeader,
						});
						resp.end(JSON.stringify({
							success: true,
							message: 'Payment verified and settled',
						}));

						return {
							noWebhookResponse: true,
							workflowData: prepareOutput(requestData),
						};
					}

				} catch (error: any) {
					return sendJsonResponse(402, {
						x402Version,
						error: error?.message || "Payment settlement failed",
						accepts: [paymentRequirements],
					});
				}
			}

		} catch (error: any) {
			return sendJsonResponse(500, {
				error: 'Payment processing error',
				message: error?.message || 'An unexpected error occurred',
			});
		}
	}

	private async validateAuth(context: IWebhookFunctions) {
		return await validateWebhookAuthentication(context, this.authPropertyName);
	}

	private async handleFormData(
		context: IWebhookFunctions,
		prepareOutput: (data: INodeExecutionData) => INodeExecutionData[][],
	) {
		const req = context.getRequestObject() as MultiPartFormData.Request;
		a.ok(req.contentType === 'multipart/form-data', 'Expected multipart/form-data');
		const options = context.getNodeParameter('options', {}) as IDataObject;
		const { data, files } = req.body;

		const returnItem: INodeExecutionData = {
			json: {
				headers: req.headers,
				params: req.params,
				query: req.query,
				body: data,
			},
		};

		if (files && Object.keys(files).length) {
			returnItem.binary = {};
		}

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
				if (multiFile) {
					binaryPropertyName += fileCount++;
				}
				if (options.binaryPropertyName) {
					binaryPropertyName = `${options.binaryPropertyName}${count}`;
				}

				returnItem.binary![binaryPropertyName] = await context.nodeHelpers.copyBinaryFile(
					file.filepath,
					file.originalFilename ?? file.newFilename,
					file.mimetype,
				);

				// Delete original file to prevent tmp directory from growing too large
				await rm(file.filepath, { force: true });

				count += 1;
			}
		}

		return { workflowData: prepareOutput(returnItem) };
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
				const fileName = req.contentDisposition?.filename ?? uuid();
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