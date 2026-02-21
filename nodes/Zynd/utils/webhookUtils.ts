import type {
	IWebhookFunctions,
	INodeExecutionData,
	IDataObject,
	ICredentialDataDecryptedObject,
	MultiPartFormData,
} from 'n8n-workflow';
import { WebhookAuthorizationError } from './webhookError';

export type WebhookParameters = {
	httpMethod: string | string[];
	responseMode: string;
	responseData: string;
	responseCode?: number;
	options?: {
		responseData?: string;
		responseCode?: {
			values?: {
				responseCode: number;
				customCode?: number;
			};
		};
		noResponseBody?: boolean;
	};
};

export const getResponseCode = (parameters: WebhookParameters) => {
	if (parameters.responseCode) {
		return parameters.responseCode;
	}
	const responseCodeOptions = parameters.options;
	if (responseCodeOptions?.responseCode?.values) {
		const { responseCode, customCode } = responseCodeOptions.responseCode.values;
		if (customCode) {
			return customCode;
		}
		return responseCode;
	}
	return 200;
};

export const getResponseData = (parameters: WebhookParameters) => {
	const { responseData, responseMode, options } = parameters;
	if (responseData) return responseData;

	if (responseMode === 'onReceived') {
		const data = options?.responseData;
		if (data) return data;
	}

	if (options?.noResponseBody) return 'noData';

	return undefined;
};

export const configuredOutputs = (parameters: WebhookParameters) => {
	const httpMethod = parameters.httpMethod;

	if (!Array.isArray(httpMethod))
		return [
			{
				type: 'main',
				displayName: httpMethod,
			},
		];

	const outputs = httpMethod.map((method) => {
		return {
			type: 'main',
			displayName: method,
		};
	});

	return outputs;
};

export const setupOutputConnection = (
	ctx: IWebhookFunctions,
	method: string,
	additionalData: {
		jwtPayload?: IDataObject;
	},
) => {
	const httpMethod = ctx.getNodeParameter('httpMethod', []) as string[] | string;
	let webhookUrl = ctx.getNodeWebhookUrl('default') as string;
	const executionMode = ctx.getMode() === 'manual' ? 'test' : 'production';

	if (executionMode === 'test') {
		webhookUrl = webhookUrl.replace('/webhook/', '/webhook-test/');
	}

	if (!Array.isArray(httpMethod)) {
		return (outputData: INodeExecutionData): INodeExecutionData[][] => {
			outputData.json.webhookUrl = webhookUrl;
			outputData.json.executionMode = executionMode;
			if (additionalData?.jwtPayload) {
				outputData.json.jwtPayload = additionalData.jwtPayload;
			}
			return [[outputData]];
		};
	}

	const outputIndex = httpMethod.indexOf(method.toUpperCase());
	const outputs: INodeExecutionData[][] = httpMethod.map(() => []);

	return (outputData: INodeExecutionData): INodeExecutionData[][] => {
		outputData.json.webhookUrl = webhookUrl;
		outputData.json.executionMode = executionMode;
		if (additionalData?.jwtPayload) {
			outputData.json.jwtPayload = additionalData.jwtPayload;
		}
		outputs[outputIndex] = [outputData];
		return outputs;
	};
};

export const isIpAllowed = (
	allowlist: string | string[] | undefined,
	ips: string[],
	ip?: string,
) => {
	if (allowlist === undefined || allowlist === '') {
		return true;
	}

	if (!Array.isArray(allowlist)) {
		allowlist = allowlist.split(',').map((entry) => entry.trim());
	}

	// Simple IP check without BlockList (for compatibility)
	const allowedIps = new Set(allowlist);

	if (ip && allowedIps.has(ip)) {
		return true;
	}

	if (ips.some((ipEntry) => allowedIps.has(ipEntry))) {
		return true;
	}

	// Also check CIDR ranges (simplified)
	for (const entry of allowlist) {
		if (entry.includes('/')) {
			// Basic CIDR check - for exact match of the network part
			const [network] = entry.split('/');
			if (ip && ip.startsWith(network.substring(0, network.lastIndexOf('.')))) {
				return true;
			}
		}
	}

	return false;
};

export const checkResponseModeConfiguration = (context: IWebhookFunctions) => {
	const responseMode = context.getNodeParameter('responseMode', 'onReceived') as string;
	const connectedNodes = context.getChildNodes(context.getNode().name);

	const isRespondToWebhookConnected = connectedNodes.some(
		(node) =>
			node.type === 'n8n-nodes-base.respondToWebhook' || node.type === 'CUSTOM.respondToWebhook',
	);

	if (!isRespondToWebhookConnected && responseMode === 'responseNode') {
		throw new Error(
			'No Respond to Webhook node found in the workflow. Insert a Respond to Webhook node or choose another option for the "Respond" parameter.',
		);
	}

	if (isRespondToWebhookConnected && !['responseNode', 'streaming'].includes(responseMode)) {
		throw new Error(
			'Unused Respond to Webhook node found in the workflow. Set the "Respond" parameter to "Using Respond to Webhook Node" or remove the Respond to Webhook node.',
		);
	}
};

export async function validateWebhookAuthentication(
	ctx: IWebhookFunctions,
	authPropertyName: string,
) {
	const authentication = ctx.getNodeParameter(authPropertyName) as string;
	if (authentication === 'none') return;

	const req = ctx.getRequestObject();
	const headers = ctx.getHeaderData();

	if (authentication === 'basicAuth') {
		let expectedAuth: ICredentialDataDecryptedObject | undefined;
		try {
			expectedAuth = await ctx.getCredentials<ICredentialDataDecryptedObject>('httpBasicAuth');
		} catch {}

		if (expectedAuth === undefined || !expectedAuth.user || !expectedAuth.password) {
			throw new WebhookAuthorizationError(500, 'No authentication data defined on node!');
		}

		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Basic ')) {
			throw new WebhookAuthorizationError(401);
		}

		const base64Credentials = authHeader.split(' ')[1];
		const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
		const [user, password] = credentials.split(':');

		if (user !== expectedAuth.user || password !== expectedAuth.password) {
			throw new WebhookAuthorizationError(403);
		}
	} else if (authentication === 'headerAuth') {
		let expectedAuth: ICredentialDataDecryptedObject | undefined;
		try {
			expectedAuth = await ctx.getCredentials<ICredentialDataDecryptedObject>('httpHeaderAuth');
		} catch {}

		if (expectedAuth === undefined || !expectedAuth.name || !expectedAuth.value) {
			throw new WebhookAuthorizationError(500, 'No authentication data defined on node!');
		}
		const headerName = (expectedAuth.name as string).toLowerCase();
		const expectedValue = expectedAuth.value as string;

		if (
			!headers.hasOwnProperty(headerName) ||
			(headers as IDataObject)[headerName] !== expectedValue
		) {
			throw new WebhookAuthorizationError(403);
		}
	}
}

export async function handleFormData(
	context: IWebhookFunctions,
	prepareOutput: (data: INodeExecutionData) => INodeExecutionData[][],
) {
	const req = context.getRequestObject() as MultiPartFormData.Request;
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

	if (files) {
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

				returnItem.binary![binaryPropertyName] = await context.nodeHelpers.copyBinaryFile(
					file.filepath,
					file.originalFilename ?? file.newFilename,
					file.mimetype,
				);

				count += 1;
			}
		}
	}

	return { workflowData: prepareOutput(returnItem) };
}
