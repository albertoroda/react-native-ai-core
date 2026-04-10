/**
 * Bundled model catalog data — compiled directly into the library JS output.
 *
 * Using static imports (rather than require('../model_allowlists/*.json'))
 * ensures the paths resolve correctly from lib/module/index.js regardless of
 * where the package is installed, since relative require paths are NOT adjusted
 * by babel when the compilation output directory changes depth.
 */

// Minimal shape — only fields consumed by fetchModelCatalog / downloadModel.
type CatalogEntry = {
  name: string;
  modelId: string;
  modelFile: string;
  commitHash: string;
  sizeInBytes: number;
  description?: string;
  minDeviceMemoryInGb?: number;
  [key: string]: unknown;
};

type CatalogFile = { models: CatalogEntry[] };

// ── v1.0.4 ────────────────────────────────────────────────────────────────────
const v1_0_4: CatalogFile = {
  models: [
    {
      name: 'Gemma-3n-E2B-it',
      modelId: 'google/gemma-3n-E2B-it-litert-lm',
      modelFile: 'gemma-3n-E2B-it-int4.litertlm',
      description:
        '**⚠️⚠️⚠️ Your current app version is too old to support this model. For continued access and the best experience, please update your app to the newest version.**',
      sizeInBytes: 3388604416,
      minDeviceMemoryInGb: 8,
      commitHash: '73b019b63436d346f68dd9c1dbfd117eb264d888',
    },
    {
      name: 'Gemma-3n-E4B-it',
      modelId: 'google/gemma-3n-E4B-it-litert-lm',
      modelFile: 'gemma-3n-E4B-it-int4.litertlm',
      description:
        '**⚠️⚠️⚠️ Your current app version is too old to support this model. For continued access and the best experience, please update your app to the newest version.**',
      sizeInBytes: 4652318720,
      minDeviceMemoryInGb: 12,
      commitHash: '3d0179a0648381585ab337e170b7517aae8e0ce4',
    },
    {
      name: 'Gemma3-1B-IT',
      modelId: 'litert-community/Gemma3-1B-IT',
      modelFile: 'gemma3-1b-it-int4.litertlm',
      description:
        'A variant of [google/Gemma-3-1B-IT](https://huggingface.co/google/Gemma-3-1B-IT) with 4-bit quantization ready for deployment on Android using the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference)',
      sizeInBytes: 584417280,
      minDeviceMemoryInGb: 6,
      commitHash: '42d538a932e8d5b12e6b3b455f5572560bd60b2c',
    },
  ],
};

// ── v1.0.5 (identical to 1.0.4) ───────────────────────────────────────────────
const v1_0_5: CatalogFile = v1_0_4;

// ── v1.0.6 ────────────────────────────────────────────────────────────────────
const v1_0_6: CatalogFile = {
  models: [
    {
      name: 'Gemma-3n-E2B-it',
      modelId: 'google/gemma-3n-E2B-it-litert-lm',
      modelFile: 'gemma-3n-E2B-it-int4.litertlm',
      description:
        'Preview version of [Gemma 3n E2B](https://ai.google.dev/gemma/docs/gemma-3n) ready for deployment on Android using the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference). The current checkpoint supports text, vision, and audio input, with 4096 context length.',
      sizeInBytes: 3388604416,
      minDeviceMemoryInGb: 8,
      commitHash: '73b019b63436d346f68dd9c1dbfd117eb264d888',
    },
    {
      name: 'Gemma-3n-E4B-it',
      modelId: 'google/gemma-3n-E4B-it-litert-lm',
      modelFile: 'gemma-3n-E4B-it-int4.litertlm',
      description:
        'Preview version of [Gemma 3n E4B](https://ai.google.dev/gemma/docs/gemma-3n) ready for deployment on Android using the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference). The current checkpoint supports text, vision, and audio input, with 4096 context length.',
      sizeInBytes: 4652318720,
      minDeviceMemoryInGb: 12,
      commitHash: '3d0179a0648381585ab337e170b7517aae8e0ce4',
    },
    {
      name: 'Gemma3-1B-IT',
      modelId: 'litert-community/Gemma3-1B-IT',
      modelFile: 'gemma3-1b-it-int4.litertlm',
      description:
        'A variant of [google/Gemma-3-1B-IT](https://huggingface.co/google/Gemma-3-1B-IT) with 4-bit quantization ready for deployment on Android using the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference)',
      sizeInBytes: 584417280,
      minDeviceMemoryInGb: 6,
      commitHash: '42d538a932e8d5b12e6b3b455f5572560bd60b2c',
    },
  ],
};

// ── v1.0.7 (identical to 1.0.6) ───────────────────────────────────────────────
const v1_0_7: CatalogFile = v1_0_6;

// ── Shared entries for v1.0.8+ ────────────────────────────────────────────────
const gemma3n2b_v8: CatalogEntry = {
  name: 'Gemma-3n-E2B-it',
  modelId: 'google/gemma-3n-E2B-it-litert-lm',
  modelFile: 'gemma-3n-E2B-it-int4.litertlm',
  description:
    'A variant of [Gemma 3n E2B](https://ai.google.dev/gemma/docs/gemma-3n) ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md). It supports text, vision, and audio input, with 4096 context length.',
  sizeInBytes: 3655827456,
  minDeviceMemoryInGb: 8,
  commitHash: 'ba9ca88da013b537b6ed38108be609b8db1c3a16',
  llmSupportImage: true,
  llmSupportAudio: true,
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 1.0,
    maxTokens: 4096,
    accelerators: 'cpu,gpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab', 'llm_ask_image', 'llm_ask_audio'],
  bestForTaskTypes: ['llm_ask_image', 'llm_ask_audio'],
};
const gemma3n4b_v8: CatalogEntry = {
  name: 'Gemma-3n-E4B-it',
  modelId: 'google/gemma-3n-E4B-it-litert-lm',
  modelFile: 'gemma-3n-E4B-it-int4.litertlm',
  description:
    'A variant of [Gemma 3n E4B](https://ai.google.dev/gemma/docs/gemma-3n) ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md). It supports text, vision, and audio input, with 4096 context length.',
  sizeInBytes: 4919541760,
  minDeviceMemoryInGb: 12,
  commitHash: '297ed75955702dec3503e00c2c2ecbbf475300bc',
  llmSupportImage: true,
  llmSupportAudio: true,
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 1.0,
    maxTokens: 4096,
    accelerators: 'cpu,gpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab', 'llm_ask_image', 'llm_ask_audio'],
};
const gemma3_1b: CatalogEntry = {
  name: 'Gemma3-1B-IT',
  modelId: 'litert-community/Gemma3-1B-IT',
  modelFile: 'gemma3-1b-it-int4.litertlm',
  description:
    'A variant of [google/Gemma-3-1B-IT](https://huggingface.co/google/Gemma-3-1B-IT) with 4-bit quantization ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md).',
  sizeInBytes: 584417280,
  minDeviceMemoryInGb: 6,
  commitHash: '42d538a932e8d5b12e6b3b455f5572560bd60b2c',
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 1.0,
    maxTokens: 1024,
    accelerators: 'gpu,cpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab'],
  bestForTaskTypes: ['llm_chat', 'llm_prompt_lab'],
};
const qwen25_1b5: CatalogEntry = {
  name: 'Qwen2.5-1.5B-Instruct',
  modelId: 'litert-community/Qwen2.5-1.5B-Instruct',
  modelFile: 'Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm',
  description:
    'A variant of [Qwen/Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md).',
  sizeInBytes: 1597931520,
  minDeviceMemoryInGb: 6,
  commitHash: '19edb84c69a0212f29a6ef17ba0d6f278b6a1614',
  defaultConfig: {
    topK: 20,
    topP: 0.8,
    temperature: 0.7,
    maxTokens: 4096,
    accelerators: 'gpu,cpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab'],
};
const phi4mini: CatalogEntry = {
  name: 'Phi-4-mini-instruct',
  modelId: 'litert-community/Phi-4-mini-instruct',
  modelFile: 'Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm',
  description:
    'A variant of [microsoft/Phi-4-mini-instruct](https://huggingface.co/microsoft/Phi-4-mini-instruct) ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md).',
  sizeInBytes: 3910090752,
  minDeviceMemoryInGb: 6,
  commitHash: '054f4e2694a86f81a129a40596e08b8d74770a9d',
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 1.0,
    maxTokens: 4096,
    accelerators: 'gpu,cpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab'],
};
const deepseekR1_1b5: CatalogEntry = {
  name: 'DeepSeek-R1-Distill-Qwen-1.5B',
  modelId: 'litert-community/DeepSeek-R1-Distill-Qwen-1.5B',
  modelFile:
    'DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm',
  description:
    'A variant of [deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B) ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/kotlin/README.md).',
  sizeInBytes: 1833451520,
  minDeviceMemoryInGb: 6,
  commitHash: 'e34bb88632342d1f9640bad579a45134eb1cf988',
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 1.0,
    maxTokens: 4096,
    accelerators: 'gpu,cpu',
  },
  taskTypes: ['llm_chat', 'llm_prompt_lab'],
};
const tinyGarden_v10: CatalogEntry = {
  name: 'TinyGarden-270M',
  modelId: 'litert-community/functiongemma-270m-ft-tiny-garden',
  modelFile: 'tiny_garden_q8_ekv1024.litertlm',
  description: 'Fine-tuned Function Gemma 270M model for Tiny Garden.',
  sizeInBytes: 288964608,
  minDeviceMemoryInGb: 6,
  commitHash: 'c205853ff82da86141a1105faa2344a8b176dfe7',
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 0.0,
    maxTokens: 1024,
    accelerators: 'cpu',
  },
  taskTypes: ['llm_tiny_garden'],
  bestForTaskTypes: ['llm_tiny_garden'],
};
const mobileActions: CatalogEntry = {
  name: 'MobileActions-270M',
  modelId: 'litert-community/functiongemma-270m-ft-mobile-actions',
  modelFile: 'mobile_actions_q8_ekv1024.litertlm',
  description: 'Fine-tuned Function Gemma 270M model for Mobile Actions.',
  sizeInBytes: 288964608,
  minDeviceMemoryInGb: 6,
  commitHash: '38942192c9b723af836d489074823ff33d4a3e7a',
  defaultConfig: {
    topK: 64,
    topP: 0.95,
    temperature: 0.0,
    maxTokens: 1024,
    accelerators: 'cpu',
  },
  taskTypes: ['llm_mobile_actions'],
  bestForTaskTypes: ['llm_mobile_actions'],
};

// ── v1.0.8 ────────────────────────────────────────────────────────────────────
const v1_0_8: CatalogFile = {
  models: [
    gemma3n2b_v8,
    gemma3n4b_v8,
    gemma3_1b,
    qwen25_1b5,
    phi4mini,
    deepseekR1_1b5,
  ],
};

// ── v1.0.9 ────────────────────────────────────────────────────────────────────
const v1_0_9: CatalogFile = {
  models: [
    gemma3n2b_v8,
    gemma3n4b_v8,
    gemma3_1b,
    qwen25_1b5,
    phi4mini,
    deepseekR1_1b5,
    {
      name: 'TinyGarden-270M',
      modelId: 'google/functiongemma-270m-it',
      modelFile: 'tiny_garden.litertlm',
      description: 'Fine-tuned Function Gemma 270M model for Tiny Garden.',
      sizeInBytes: 288440320,
      minDeviceMemoryInGb: 6,
      commitHash: 'f54f8715e2b205f72c350f6efa748fd29fa19d98',
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 0.0,
        maxTokens: 1024,
        accelerators: 'cpu',
      },
      taskTypes: ['llm_tiny_garden'],
      bestForTaskTypes: ['llm_tiny_garden'],
    },
  ],
};

// ── v1.0.10 ───────────────────────────────────────────────────────────────────
const v1_0_10: CatalogFile = {
  models: [
    gemma3n2b_v8,
    gemma3n4b_v8,
    gemma3_1b,
    qwen25_1b5,
    deepseekR1_1b5,
    tinyGarden_v10,
    mobileActions,
  ],
};

// ── v1.0.11 ───────────────────────────────────────────────────────────────────
const v1_0_11: CatalogFile = {
  models: [
    {
      name: 'Gemma-4-E2B-it',
      modelId: 'litert-community/gemma-4-E2B-it-litert-lm',
      modelFile: 'gemma-4-E2B-it.litertlm',
      description:
        'A variant of Gemma 4 E2B ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/docs/api/kotlin/getting_started.md). It supports multi-modality input, with up to 32K context length.',
      sizeInBytes: 2583085056,
      minDeviceMemoryInGb: 8,
      commitHash: '7fa1d78473894f7e736a21d920c3aa80f950c0db',
      llmSupportImage: true,
      llmSupportAudio: true,
      llmSupportThinking: true,
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 1.0,
        maxContextLength: 32000,
        maxTokens: 4000,
        accelerators: 'gpu,cpu',
        visionAccelerator: 'gpu',
      },
      taskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_agent_chat',
        'llm_ask_image',
        'llm_ask_audio',
      ],
      bestForTaskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_agent_chat',
        'llm_ask_image',
        'llm_ask_audio',
      ],
    },
    {
      name: 'Gemma-4-E4B-it',
      modelId: 'litert-community/gemma-4-E4B-it-litert-lm',
      modelFile: 'gemma-4-E4B-it.litertlm',
      description:
        'A variant of Gemma 4 E4B ready for deployment on Android using [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/docs/api/kotlin/getting_started.md). It supports multi-modality input, with up to 32K context length.',
      sizeInBytes: 3654467584,
      minDeviceMemoryInGb: 12,
      commitHash: '9695417f248178c63a9f318c6e0c56cb917cb837',
      llmSupportImage: true,
      llmSupportAudio: true,
      llmSupportThinking: true,
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 1.0,
        maxContextLength: 32000,
        maxTokens: 4000,
        accelerators: 'gpu,cpu',
        visionAccelerator: 'gpu',
      },
      taskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_agent_chat',
        'llm_ask_image',
        'llm_ask_audio',
      ],
      bestForTaskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_agent_chat',
        'llm_ask_image',
        'llm_ask_audio',
      ],
    },
    gemma3n2b_v8,
    gemma3n4b_v8,
    gemma3_1b,
    qwen25_1b5,
    deepseekR1_1b5,
    tinyGarden_v10,
    mobileActions,
  ],
};

// ── ios_1.0.0 ─────────────────────────────────────────────────────────────────
const ios_1_0_0: CatalogFile = {
  models: [
    {
      name: 'Gemma-3n-E2B-it',
      modelId: 'google/gemma-3n-E2B-it-litert-lm',
      modelFile: 'gemma-3n-E2B-it-int4.litertlm',
      description:
        'A variant of [Gemma 3n E2B](https://ai.google.dev/gemma/docs/gemma-3n) on iOS. The current checkpoint suppots text, vision, and audio input, with 4096 context length.',
      sizeInBytes: 3388604416,
      minDeviceMemoryInGb: 6,
      commitHash: '73b019b63436d346f68dd9c1dbfd117eb264d888',
      llmSupportImage: true,
      llmSupportAudio: true,
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 1.0,
        maxTokens: 4096,
        accelerators: 'gpu',
      },
      taskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_ask_image',
        'llm_ask_audio',
      ],
      bestForTaskTypes: ['llm_ask_image', 'llm_ask_audio'],
    },
    {
      name: 'Gemma-3n-E4B-it',
      modelId: 'google/gemma-3n-E4B-it-litert-lm',
      modelFile: 'gemma-3n-E4B-it-int4.litertlm',
      description:
        'A variant of [Gemma 3n E4B](https://ai.google.dev/gemma/docs/gemma-3n) on iOS. The current checkpoint supports text, vision, and audio input, with 4096 context length.',
      sizeInBytes: 4652318720,
      minDeviceMemoryInGb: 8,
      commitHash: '3d0179a0648381585ab337e170b7517aae8e0ce4',
      llmSupportImage: true,
      llmSupportAudio: true,
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 1.0,
        maxTokens: 4096,
        accelerators: 'gpu',
      },
      taskTypes: [
        'llm_chat',
        'llm_prompt_lab',
        'llm_ask_image',
        'llm_ask_audio',
      ],
    },
    {
      name: 'Gemma3-1B-IT',
      modelId: 'litert-community/Gemma3-1B-IT',
      modelFile: 'gemma3-1b-it-int4.litertlm',
      description:
        'A variant of [google/Gemma-3-1B-IT](https://huggingface.co/google/Gemma-3-1B-IT) with 4-bit quantization ready for deployment on iOS',
      sizeInBytes: 584417280,
      minDeviceMemoryInGb: 4,
      commitHash: '42d538a932e8d5b12e6b3b455f5572560bd60b2c',
      defaultConfig: {
        topK: 64,
        topP: 0.95,
        temperature: 1.0,
        maxTokens: 4096,
        accelerators: 'cpu',
      },
      taskTypes: ['llm_chat', 'llm_prompt_lab'],
      bestForTaskTypes: ['llm_chat', 'llm_prompt_lab'],
    },
  ],
};

// ── Export ────────────────────────────────────────────────────────────────────
export const CATALOG_MAP: Record<string, CatalogFile> = {
  '1_0_4': v1_0_4,
  '1_0_5': v1_0_5,
  '1_0_6': v1_0_6,
  '1_0_7': v1_0_7,
  '1_0_8': v1_0_8,
  '1_0_9': v1_0_9,
  '1_0_10': v1_0_10,
  '1_0_11': v1_0_11,
  ios_1_0_0,
};
