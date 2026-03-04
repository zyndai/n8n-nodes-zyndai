import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { createWalletClient, http, type Chain } from 'viem';
import { HDKey, hdKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';

import {
	mainnet,
	sepolia,
	base,
	baseSepolia,
	polygon,
	polygonMumbai,
	optimism,
	optimismSepolia,
	arbitrum,
	arbitrumSepolia,
	avalanche,
	avalancheFuji,
	bsc,
	bscTestnet,
} from 'viem/chains';

// Network name to Chain mapping
const NETWORK_MAP: Record<string, Chain> = {
	// Ethereum
	'ethereum': mainnet,
	'eth': mainnet,
	'mainnet': mainnet,
	'sepolia': sepolia,
	'eth-sepolia': sepolia,

	// Base
	'base': base,
	'base-mainnet': base,
	'base-sepolia': baseSepolia,

	// Polygon
	'polygon': polygon,
	'matic': polygon,
	'polygon-mainnet': polygon,
	'polygon-mumbai': polygonMumbai,
	'mumbai': polygonMumbai,

	// Optimism
	'optimism': optimism,
	'op': optimism,
	'op-mainnet': optimism,
	'optimism-sepolia': optimismSepolia,
	'op-sepolia': optimismSepolia,

	// Arbitrum
	'arbitrum': arbitrum,
	'arb': arbitrum,
	'arbitrum-one': arbitrum,
	'arbitrum-sepolia': arbitrumSepolia,
	'arb-sepolia': arbitrumSepolia,

	// Avalanche
	'avalanche': avalanche,
	'avax': avalanche,
	'avalanche-c': avalanche,
	'avalanche-fuji': avalancheFuji,
	'fuji': avalancheFuji,

	// BSC
	'bsc': bsc,
	'bnb': bsc,
	'binance': bsc,
	'bsc-mainnet': bsc,
	'bsc-testnet': bscTestnet,
	'bnb-testnet': bscTestnet,
};

export class X402HttpRequest implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zynd HTTP Request (x402)',
		name: 'zyndHttpRequestX402',
		icon: { light: 'file:../../icons/zynd.svg', dark: 'file:../../icons/zynd.svg' },
		group: ['transform'],
		version: 1,
		description: 'Make HTTP requests to paid AI agents with automatic x402 micropayment handling (USDC on EVM chains)',
		usableAsTool: true,
		defaults: {
			name: 'HTTP Request (x402)',
			color: '#0088cc',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'web3wallet',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://api.example.com/endpoint',
				description: 'The URL to make the request to',
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{
						name: 'GET',
						value: 'GET',
					},
					{
						name: 'POST',
						value: 'POST',
					},
					{
						name: 'PUT',
						value: 'PUT',
					},
					{
						name: 'DELETE',
						value: 'DELETE',
					},
					{
						name: 'PATCH',
						value: 'PATCH',
					},
				],
				default: 'GET',
				description: 'The HTTP method to use',
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
					{ name: 'Avalanche', value: 'avalanche' },
					{ name: 'BSC', value: 'bsc' },
				],
				default: 'base-sepolia',
				required: true,
				description: 'Blockchain network to use for payments',
			},
			{
				displayName: 'Send Body',
				name: 'sendBody',
				type: 'boolean',
				default: false,
				description: 'Whether to send a body with the request',
			},
			{
				displayName: 'Body Content Type',
				name: 'contentType',
				type: 'options',
				displayOptions: {
					show: {
						sendBody: [true],
					},
				},
				options: [
					{
						name: 'JSON',
						value: 'application/json',
					},
					{
						name: 'Form URL Encoded',
						value: 'application/x-www-form-urlencoded',
					},
					{
						name: 'Raw',
						value: 'text/plain',
					},
				],
				default: 'application/json',
			},
			{
				displayName: 'Body (JSON)',
				name: 'jsonBody',
				type: 'json',
				displayOptions: {
					show: {
						sendBody: [true],
						contentType: ['application/json'],
					},
				},
				default: '{}',
				description: 'Body in JSON format',
			},
			{
				displayName: 'Body (Raw)',
				name: 'rawBody',
				type: 'string',
				displayOptions: {
					show: {
						sendBody: [true],
						contentType: ['text/plain', 'application/x-www-form-urlencoded'],
					},
				},
				default: '',
				description: 'Raw body content',
			},
			{
				displayName: 'Send Headers',
				name: 'sendHeaders',
				type: 'boolean',
				default: false,
				description: 'Whether to send custom headers',
			},
			{
				displayName: 'Headers',
				name: 'headers',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						sendHeaders: [true],
					},
				},
				default: {},
				options: [
					{
						name: 'parameter',
						displayName: 'Header',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Max Payment (USD)',
				name: 'maxPaymentUsd',
				type: 'number',
				default: 0.1,
				description: 'Maximum payment amount in USD to allow per request',
				typeOptions: {
					minValue: 0,
					numberPrecision: 2,
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get credentials
		const credentials = await this.getCredentials('web3wallet');
		const walletSeed = credentials.wallet_seed as string;

		if (!walletSeed) {
			throw new NodeOperationError(this.getNode(), 'Wallet seed is required');
		}

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const url = this.getNodeParameter('url', itemIndex) as string;
				const method = this.getNodeParameter('method', itemIndex) as string;
				const networkName = this.getNodeParameter('network', itemIndex) as string;
				const sendBody = this.getNodeParameter('sendBody', itemIndex, false) as boolean;
				const sendHeaders = this.getNodeParameter('sendHeaders', itemIndex, false) as boolean;
				const maxPaymentUsd = this.getNodeParameter('maxPaymentUsd', itemIndex, 0.1) as number;

				// Get the chain for the selected network
				const chain = NETWORK_MAP[networkName];
				if (!chain) {
					throw new NodeOperationError(
						this.getNode(),
						`Network "${networkName}" is not supported`,
						{ itemIndex }
					);
				}

				// Create wallet client
				const seed = Buffer.from(walletSeed, 'base64');
				const hdKey = HDKey.fromMasterSeed(seed);
				const account = hdKeyToAccount(hdKey);

				const walletClient = createWalletClient({
					account,
					chain,
					transport: http(),
				});

				// Convert maxPaymentUsd to base units (assuming USDC with 6 decimals)
				const maxValueInBaseUnits = BigInt(Math.floor(maxPaymentUsd * 1_000_000));

				// Wrap fetch with payment handling
				const fetchWithPay = wrapFetchWithPayment(
					fetch,
					walletClient as any,
					maxValueInBaseUnits
				);

				// Build headers
				const headers: Record<string, string> = {};

				if (sendHeaders) {
					const headerParams = this.getNodeParameter('headers.parameter', itemIndex, []) as Array<{
						name: string;
						value: string;
					}>;
					headerParams.forEach((header) => {
						if (header.name) {
							headers[header.name] = header.value;
						}
					});
				}

				// Build request options
				const requestOptions: RequestInit = {
					method,
					headers,
				};

				// Add body if needed
				if (sendBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
					const contentType = this.getNodeParameter('contentType', itemIndex) as string;
					headers['Content-Type'] = contentType;

					if (contentType === 'application/json') {
						const jsonBody = this.getNodeParameter('jsonBody', itemIndex, '{}') as string;
						requestOptions.body = typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody);
					} else {
						requestOptions.body = this.getNodeParameter('rawBody', itemIndex, '') as string;
					}
				}

				// Make the request with automatic payment handling
				const response = await fetchWithPay(url, requestOptions);

				// Parse response
				const contentTypeHeader = response.headers.get('content-type');
				let responseData: any;

				if (contentTypeHeader?.includes('application/json')) {
					responseData = await response.json();
				} else {
					responseData = await response.text();
				}

				// Check for X-PAYMENT-RESPONSE header to detect if payment was made
				const paymentResponseHeader = response.headers.get('X-PAYMENT-RESPONSE');
				
				returnData.push({
					json: {
						statusCode: response.status,
						statusMessage: response.statusText,
						body: responseData,
						headers: Object.fromEntries(response.headers.entries()),
						...(paymentResponseHeader && {
							_x402Payment: {
								status: 'paid',
								paymentResponse: paymentResponseHeader,
								network: networkName,
								chainId: chain.id,
							}
						})
					},
					pairedItem: { item: itemIndex },
				});

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
							stack: error.stack,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}