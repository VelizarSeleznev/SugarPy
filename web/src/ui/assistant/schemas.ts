import { toOpenAICompatibleTools } from './providerTransport';

const toJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  const rawType = typeof schema.type === 'string' ? schema.type.toLowerCase() : schema.type;
  if (rawType === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, toJsonSchema(value)])
    );
    return {
      type: 'object',
      properties,
      required: Array.isArray(schema.required) ? schema.required : [],
      additionalProperties: false
    };
  }
  if (rawType === 'array') {
    return {
      type: 'array',
      items: toJsonSchema(schema.items ?? {})
    };
  }
  return {
    ...schema,
    type: rawType
  };
};

const TOOL_DECLARATIONS = [
  {
    name: 'get_notebook_summary',
    description: 'Return a concise summary of the current notebook, defaults, and cell ordering.',
    parameters: {
      type: 'OBJECT',
      properties: {
        scope: {
          type: 'STRING',
          enum: ['notebook', 'active']
        }
      },
      required: ['scope']
    }
  },
  {
    name: 'list_cells',
    description: 'List notebook cells with ids, types, short previews, and error flags.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_active_cell',
    description: 'Return the currently active cell, if any.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_cell',
    description: 'Return the full content of a cell by id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cellId: { type: 'STRING' }
      },
      required: ['cellId']
    }
  },
  {
    name: 'get_recent_errors',
    description: 'Return cells with visible error output.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'search_cells',
    description:
      'Search notebook cells by source text or useful category. Use this instead of requesting the full notebook when you need targeted context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
        category: {
          type: 'STRING',
          enum: ['all', 'errors', 'solve-plot', 'helpers', 'markdown']
        }
      },
      required: ['query', 'category']
    }
  },
  {
    name: 'get_reference',
    description: 'Return built-in SugarPy documentation for a specific topic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        section: {
          type: 'STRING',
          enum: ['overview', 'math_cells', 'plotting', 'cell_types', 'assistant']
        }
      },
      required: ['section']
    }
  }
] as const;

export const OPENAI_TOOL_DECLARATIONS = TOOL_DECLARATIONS.map((tool) => ({
  type: 'function' as const,
  name: tool.name,
  description: tool.description,
  parameters: toJsonSchema(tool.parameters),
  strict: true
}));

export const SANDBOX_TOOL_DECLARATION = {
  name: 'run_code_in_sandbox',
  description:
    'Run code or Math-cell content in an isolated temporary kernel for self-checking. This never mutates the live notebook.',
  parameters: {
    type: 'OBJECT',
    properties: {
      target: {
        type: 'STRING',
        enum: ['code', 'math']
      },
      code: { type: 'STRING' },
      source: { type: 'STRING' },
      trigMode: {
        type: 'STRING',
        enum: ['deg', 'rad']
      },
      renderMode: {
        type: 'STRING',
        enum: ['exact', 'decimal']
      },
      contextPreset: {
        type: 'STRING',
        enum: ['none', 'bootstrap-only', 'imports-only', 'selected-cells', 'full-notebook-replay']
      },
      selectedCellIds: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      timeoutMs: { type: 'NUMBER' }
    },
    required: ['target', 'code', 'source', 'trigMode', 'renderMode', 'contextPreset', 'selectedCellIds', 'timeoutMs']
  }
} as const;

export const OPENAI_SANDBOX_TOOL_DECLARATION = {
  type: 'function' as const,
  name: SANDBOX_TOOL_DECLARATION.name,
  description: SANDBOX_TOOL_DECLARATION.description,
  parameters: toJsonSchema(SANDBOX_TOOL_DECLARATION.parameters),
  strict: true
};

export const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    userMessage: { type: 'STRING' },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    operations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: {
            type: 'STRING',
            enum: [
              'insert_cell',
              'update_cell',
              'patch_cell',
              'replace_cell_editable',
              'delete_cell',
              'move_cell',
              'set_notebook_defaults',
              'patch_user_preferences'
            ]
          },
          index: { type: 'NUMBER' },
          cellType: {
            type: 'STRING',
            enum: ['code', 'markdown', 'math', 'stoich', 'regression']
          },
          source: { type: 'STRING' },
          document: { type: 'OBJECT' },
          config: { type: 'OBJECT' },
          patch: { type: 'OBJECT' },
          cellId: { type: 'STRING' },
          trigMode: {
            type: 'STRING',
            enum: ['deg', 'rad']
          },
          renderMode: {
            type: 'STRING',
            enum: ['exact', 'decimal']
          },
          reason: { type: 'STRING' }
        },
        required: ['type']
      }
    }
  },
  required: ['summary', 'userMessage', 'warnings', 'operations']
} as const;

const OPENAI_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    userMessage: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'insert_cell',
              'update_cell',
              'patch_cell',
              'replace_cell_editable',
              'delete_cell',
              'move_cell',
              'set_notebook_defaults',
              'patch_user_preferences'
            ]
          },
          index: {
            type: ['number', 'null']
          },
          cellType: {
            type: ['string', 'null'],
            enum: ['code', 'markdown', 'math', 'stoich', 'regression', null]
          },
          source: {
            type: ['string', 'null']
          },
          document: {
            type: ['object', 'null']
          },
          config: {
            type: ['object', 'null']
          },
          patch: {
            type: ['object', 'null']
          },
          cellId: {
            type: ['string', 'null']
          },
          trigMode: {
            type: ['string', 'null'],
            enum: ['deg', 'rad', null]
          },
          renderMode: {
            type: ['string', 'null'],
            enum: ['exact', 'decimal', null]
          },
          reason: {
            type: ['string', 'null']
          }
        },
        required: [
          'type',
          'index',
          'cellType',
          'source',
          'document',
          'config',
          'patch',
          'cellId',
          'trigMode',
          'renderMode',
          'reason'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'userMessage', 'warnings', 'operations'],
  additionalProperties: false
} as const;

export const OPENAI_SUBMIT_PLAN_TOOL_DECLARATION = {
  type: 'function' as const,
  name: 'submit_plan',
  description: 'Submit the final SugarPy notebook change set.',
  parameters: OPENAI_PLAN_SCHEMA,
  strict: true
};

const PLAN_METADATA_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    userMessage: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'userMessage', 'warnings'],
  additionalProperties: false
} as const;

const PLAN_OPERATION_SCHEMA = OPENAI_PLAN_SCHEMA.properties.operations.items;

export const OPENAI_PLAN_METADATA_TOOL_DECLARATION = {
  type: 'function' as const,
  name: 'set_plan_metadata',
  description: 'Set the plan summary, user-facing message, and warning list before adding operations.',
  parameters: PLAN_METADATA_SCHEMA,
  strict: true
};

export const OPENAI_PLAN_OPERATION_TOOL_DECLARATION = {
  type: 'function' as const,
  name: 'add_plan_operation',
  description: 'Append one notebook operation to the plan. Call this once per operation.',
  parameters: PLAN_OPERATION_SCHEMA,
  strict: true
};

export const OPENAI_FINALIZE_PLAN_TOOL_DECLARATION = {
  type: 'function' as const,
  name: 'finalize_plan',
  description: 'Finish plan generation after metadata and operations have been sent.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  },
  strict: true
};

export const OPENAI_COMPATIBLE_TOOL_DECLARATIONS = toOpenAICompatibleTools(OPENAI_TOOL_DECLARATIONS);
export const OPENAI_COMPATIBLE_SANDBOX_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_SANDBOX_TOOL_DECLARATION])[0];
export const OPENAI_COMPATIBLE_SUBMIT_PLAN_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_SUBMIT_PLAN_TOOL_DECLARATION])[0];
export const OPENAI_COMPATIBLE_PLAN_METADATA_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_PLAN_METADATA_TOOL_DECLARATION])[0];
export const OPENAI_COMPATIBLE_PLAN_OPERATION_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_PLAN_OPERATION_TOOL_DECLARATION])[0];
export const OPENAI_COMPATIBLE_FINALIZE_PLAN_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_FINALIZE_PLAN_TOOL_DECLARATION])[0];

