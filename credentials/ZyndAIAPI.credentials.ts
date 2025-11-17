import type {
    ICredentialType,
    INodeProperties,
    Icon,
} from 'n8n-workflow';

export class ZyndAiApi implements ICredentialType {
    name = 'zyndAiApi';

    displayName = 'ZyndAI API';

    icon: Icon = {
        light: 'file:../icons/zynd.svg',
        dark: 'file:../icons/zynd.dark.svg'
    };

    documentationUrl = 'https://docs.zynd.ai/authentication';

    properties: INodeProperties[] = [
        {
            displayName: 'Zynd Registry URL',
            name: 'zynd-registry-url',
            type: 'string',
            default: 'https://registry.zynd.ai',
            required: true,
            placeholder: 'https://registry.zynd.ai',
            description: 'Enter Zynd Registry base URL',
        },
    ];
}