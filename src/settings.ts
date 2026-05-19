import { defineSettings } from '@frontify/platform-app';

export const settings = defineSettings({
    marketo: [
        {
            type: 'input',
            id: 'marketo-folder-name',
            label: 'Token Folder Name',
            defaultValue: 'Frontify Assets',
        },
    ],
});
