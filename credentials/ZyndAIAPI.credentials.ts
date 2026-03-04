import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ZyndAIAPI implements ICredentialType {
	name = 'zyndAiApi';

	displayName = 'Zynd AI API';

	documentationUrl = 'https://docs.zynd.ai/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://registry.zynd.ai',
			required: false,
			placeholder: 'https://registry.zynd.ai',
			description: 'The base URL of the ZyndAI registry API',
		},
		{
			displayName: 'Zynd API Key',
			name: 'apiKey',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'zynd_09b149a1b833e562ef7d1165b3628dfaa6e741c970fbc4123bff6949b0a30923',
			description: 'Generate API key from https://dashboard.zynd.ai',
		},
		{
			displayName: 'N8N API Key',
			name: 'n8nApiKey',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3YTc4MTU3Mi0wNWVkLTQ1NTAtYmFmNy1lMGQzMTE0NDY3NGMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzYzMzg0Njc4LCJleHAiOjE3NjU5NDc2MDB9.TsORQObvQTe4B0IFhXJ6CufOFGBoa-SXTeRN_YH-tMJ',
			description: 'Generate N8N API key from n8n settings',
		}
	];
}