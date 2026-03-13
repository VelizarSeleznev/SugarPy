import type { CustomCellTemplateId } from './customCellTypes';

export type SpecialCellId = 'stoich' | 'regression';

export type SpecialCellDescriptor = {
  id: SpecialCellId;
  title: string;
  description: string;
  aliases: string[];
  insertLabel: string;
  kind: 'stoich' | 'custom';
  templateId?: CustomCellTemplateId;
};

export const specialCellRegistry: SpecialCellDescriptor[] = [
  {
    id: 'stoich',
    title: 'Stoichiometry',
    description: 'Chemistry worksheet with balanced reaction and mass/mol table.',
    aliases: ['stoich', 'stoichiometry', 'chemistry', 'reaction', 'moles'],
    insertLabel: 'Stoich cell',
    kind: 'stoich',
  },
  {
    id: 'regression',
    title: 'Regression',
    description: '2D data fitting widget with table input, metrics, and plot.',
    aliases: ['regression', 'fit', 'line fit', 'quadratic fit', 'data fitting'],
    insertLabel: 'Regression cell',
    kind: 'custom',
    templateId: 'regression',
  },
];

export const findSpecialCell = (id: SpecialCellId) => specialCellRegistry.find((entry) => entry.id === id) ?? null;

export const specialFunctionIds = new Set<string>(['chem.stoichiometry_table']);
